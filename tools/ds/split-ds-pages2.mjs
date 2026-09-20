// Нарезка ДС по страницам (v2): режем граф до нужной страницы ПЕРЕД экспортом,
// иначе экспорт отдаёт оригинальный файл целиком и все куски одинаковые.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import * as figPkg from '/opt/open-pencil/packages/fig/dist/index.js'
import * as corePkg from '/opt/open-pencil/packages/core/dist/index.js'
import { exportFigFile } from '/opt/open-pencil/packages/core/dist/io/formats/fig/index.js'
import { SceneGraph } from '/opt/open-pencil/packages/scene-graph/dist/index.js'

const SOURCE = process.argv[2] ?? '/opt/open-pencil/data/ds-unpacked/canvas.fig'
const OUT_DIR = process.argv[3] ?? '/opt/open-pencil/data/ds-pages'
const WITH_INTERNAL = process.argv[4] === '--with-internal'

await mkdir(OUT_DIR, { recursive: true })

const bytes = new Uint8Array(await readFile(SOURCE))
const parsed = figPkg.parseFigBuffer(bytes.buffer)
const full = corePkg.importNodeChanges(parsed.nodeChanges, parsed.blobs, new Map(parsed.images), {
  populate: 'none'
})
const pages = full.getPages(true)
console.log(`страниц: ${pages.length}`)

/** Собирает граф только из нод выбранных страниц (плюс документ). */
function subgraphFor(pageIds, keepInternal) {
  const keep = new Set([full.rootId, ...pageIds])
  const queue = [...pageIds]
  while (queue.length > 0) {
    const node = full.getNode(queue.pop())
    if (!node) continue
    for (const childId of node.childIds) {
      if (keep.has(childId)) continue
      keep.add(childId)
      queue.push(childId)
    }
  }
  if (!keepInternal) {
    // добавляем только не-служебные страницы, которые реально нужны как контейнеры
  }
  const sub = new SceneGraph()
  sub.rootId = full.rootId
  sub.documentColorSpace = full.documentColorSpace
  sub.figKiwiVersion = full.figKiwiVersion
  sub.enabledLibraries = new Map(full.enabledLibraries)
  for (const [id, node] of full.nodes) {
    if (!keep.has(id)) continue
    sub.nodes.set(id, { ...node, childIds: node.childIds.filter((c) => keep.has(c)) })
  }
  for (const [id, ids] of full.instanceIndex) {
    if (!keep.has(id)) continue
    sub.instanceIndex.set(id, new Set([...ids].filter((i) => keep.has(i))))
  }
  // убираем служебную страницу из дерева документа, если она не нужна
  const root = sub.nodes.get(sub.rootId)
  if (root) {
    root.childIds = root.childIds.filter((id) => {
      const node = sub.nodes.get(id)
      return node?.type === 'CANVAS' && (keepInternal || !node.internalOnly)
    })
  }
  return sub
}

const manifest = []
for (const page of pages) {
  if (page.internalOnly && !WITH_INTERNAL) {
    manifest.push({ page: page.name.trim(), internal: true, skipped: true })
    continue
  }
  const safeName = page.name
    .trim()
    .replace(/[^\wа-яА-ЯёЁ\- ]+/gu, '')
    .replace(/\s+/g, '-')
    .slice(0, 40) || page.id
  const sub = subgraphFor([page.id], false)
  const nodesInSub = sub.nodes.size
  try {
    const out = await exportFigFile(sub, undefined, undefined, page.id)
    await writeFile(`${OUT_DIR}/${safeName}.fig`, out)
    manifest.push({ page: page.name.trim(), file: `${safeName}.fig`, nodes: nodesInSub, bytes: out.byteLength })
    console.log(`  ${String(nodesInSub).padStart(6)} нод → ${safeName}.fig (${Math.round(out.byteLength / 1024)} КБ)`)
  } catch (error) {
    manifest.push({ page: page.name.trim(), nodes: nodesInSub, error: String(error).slice(0, 140) })
    console.log(`  ОШИБКА «${page.name.trim()}»: ${String(error).slice(0, 110)}`)
  }
}

await writeFile(`${OUT_DIR}/manifest.json`, JSON.stringify({ source: SOURCE, pages: manifest }, null, 1))
const done = manifest.filter((m) => m.file)
console.log(`\nготово: ${done.length} файлов | суммарно нод: ${done.reduce((s, m) => s + m.nodes, 0)} | вес: ${Math.round(done.reduce((s, m) => s + m.bytes, 0) / 1024 / 1024)} МБ`)
