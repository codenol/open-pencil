// Нарезка ДС на файлы по страницам: большие .fig не влезают в браузер,
// поэтому режем на «страница-на-файл» + карту связей для линковки.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import * as figPkg from '/opt/open-pencil/packages/fig/dist/index.js'
import * as corePkg from '/opt/open-pencil/packages/core/dist/index.js'
import { exportFigFile } from '/opt/open-pencil/packages/core/dist/io/formats/fig/index.js'

const SOURCE = process.argv[2] ?? '/opt/open-pencil/data/ds-unpacked/canvas.fig'
const OUT_DIR = process.argv[3] ?? '/opt/open-pencil/data/ds-pages'
const SKIP_INTERNAL = process.argv[4] !== '--with-internal'

await mkdir(OUT_DIR, { recursive: true })

const bytes = new Uint8Array(await readFile(SOURCE))
const parsed = figPkg.parseFigBuffer(bytes.buffer)
const graph = corePkg.importNodeChanges(parsed.nodeChanges, parsed.blobs, new Map(parsed.images), {
  populate: 'none'
})
const pages = graph.getPages(true)
console.log(`страниц: ${pages.length}`)

const statOf = (page) => {
  let count = 0
  const walk = (id) => {
    const node = graph.getNode(id)
    if (!node) return
    count += 1
    for (const child of node.childIds) walk(child)
  }
  walk(page.id)
  return count
}

const manifest = []
for (const page of pages) {
  if (SKIP_INTERNAL && page.internalOnly) {
    manifest.push({ page: page.name.trim(), internal: true, skipped: true, nodes: statOf(page) })
    continue
  }
  const nodes = statOf(page)
  const fileName = page.name
    .trim()
    .replace(/[^\wа-яА-ЯёЁ\- ]+/gu, '')
    .replace(/\s+/g, '-')
    .slice(0, 40)
  const target = `${OUT_DIR}/${fileName || page.id}.fig`
  try {
    const out = await exportFigFile(graph, undefined, undefined, page.id)
    await writeFile(target, out)
    manifest.push({ page: page.name.trim(), file: target, nodes, bytes: out.byteLength })
    console.log(`  ${String(nodes).padStart(6)} нод → ${fileName}.fig (${Math.round(out.byteLength / 1024)} КБ)`)
  } catch (error) {
    manifest.push({ page: page.name.trim(), nodes, error: String(error).slice(0, 120) })
    console.log(`  ОШИБКА на «${page.name.trim()}»: ${String(error).slice(0, 100)}`)
  }
}

await writeFile(`${OUT_DIR}/manifest.json`, JSON.stringify({ source: SOURCE, pages: manifest }, null, 1))
const done = manifest.filter((m) => m.file)
console.log(`\nготово: ${done.length} файлов, пропущено служебных: ${manifest.filter((m) => m.skipped).length}`)
console.log(`всего нод в файлах: ${done.reduce((sum, m) => sum + m.nodes, 0)}`)
