// Нарезка ДС v3: из каждой страницы забираем только компоненты/сеты и их содержимое.
// draft и Tests пропускаем, декоративные макеты (инстансы/фреймы-примеры) не тащим.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import * as figPkg from '/opt/open-pencil/packages/fig/dist/index.js'
import * as corePkg from '/opt/open-pencil/packages/core/dist/index.js'
import { exportFigFile } from '/opt/open-pencil/packages/core/dist/io/formats/fig/index.js'
import { SceneGraph } from '/opt/open-pencil/packages/scene-graph/dist/index.js'

const SOURCE = process.argv[2] ?? '/opt/open-pencil/data/ds-unpacked/canvas.fig'
const OUT_DIR = process.argv[3] ?? '/opt/open-pencil/data/ds-pages3'
const SKIP_PAGES = ['draft', 'Tests component', 'Internal Only Canvas']

await mkdir(OUT_DIR, { recursive: true })
const bytes = new Uint8Array(await readFile(SOURCE))
const parsed = figPkg.parseFigBuffer(bytes.buffer)
const full = corePkg.importNodeChanges(parsed.nodeChanges, parsed.blobs, new Map(parsed.images), {
  populate: 'none'
})
const pages = full.getPages(true)
console.log(`страниц: ${pages.length}`)

/** Собирает граф: страница + все компоненты/сеты и их поддеревья (до листьев). */
function componentsOnlyGraph(pageIds) {
  const keep = new Set([full.rootId, ...pageIds])
  const componentRoots = []
  // Компоненты ищем по ВСЕМУ графу, но относим к странице по цепочке родителей.
  const pageSet = new Set(pageIds)
  const pageOf = (id) => {
    let current = full.getNode(id)
    let guard = 0
    while (current && guard < 1000) {
      if (pageSet.has(current.id)) return current.id
      current = current.parentId ? full.getNode(current.parentId) : undefined
      guard += 1
    }
    return null
  }
  for (const [id, node] of full.nodes) {
    if (node.type !== 'COMPONENT_SET' && node.type !== 'COMPONENT') continue
    if (node.parentId && full.getNode(node.parentId)?.type === 'COMPONENT_SET') continue
    if (!pageOf(id)) continue
    componentRoots.push(id)
  }
  // сохраняем компоненты целиком (включая вложенное), но не макеты-примеры
  const queue = [...componentRoots]
  while (queue.length > 0) {
    const node = full.getNode(queue.pop())
    if (!node) continue
    for (const child of node.childIds) {
      if (keep.has(child)) continue
      keep.add(child)
      queue.push(child)
    }
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
  const root = sub.nodes.get(sub.rootId)
  if (root) {
    root.childIds = root.childIds.filter((id) => {
      const node = sub.nodes.get(id)
      return node?.type === 'CANVAS'
    })
  }
  return { graph: sub, components: componentRoots.length }
}

const manifest = []
for (const page of pages) {
  const pageName = page.name.trim()
  if (page.internalOnly || SKIP_PAGES.some((skip) => pageName === skip)) {
    manifest.push({ page: pageName, skipped: true })
    continue
  }
  const safeName = pageName.replace(/[^\wа-яА-ЯёЁ\- ]+/gu, '').replace(/\s+/g, '-').slice(0, 40) || page.id
  try {
    const { graph: sub, components } = componentsOnlyGraph([page.id])
    const out = await exportFigFile(sub, undefined, undefined, page.id)
    await writeFile(`${OUT_DIR}/${safeName}.fig`, out)
    manifest.push({ page: pageName, file: `${safeName}.fig`, components, nodes: sub.nodes.size, bytes: out.byteLength })
    console.log(`  ${String(components).padStart(5)} комп. / ${String(sub.nodes.size).padStart(6)} нод → ${safeName}.fig (${Math.round(out.byteLength / 1024)} КБ)`)
  } catch (error) {
    manifest.push({ page: pageName, error: String(error).slice(0, 140) })
    console.log(`  ОШИБКА «${pageName}»: ${String(error).slice(0, 100)}`)
  }
}

await writeFile(`${OUT_DIR}/manifest.json`, JSON.stringify({ source: SOURCE, pages: manifest }, null, 1))
const done = manifest.filter((m) => m.file)
console.log(`\nфайлов: ${done.length} | компонентов: ${done.reduce((s, m) => s + m.components, 0)} | нод: ${done.reduce((s, m) => s + m.nodes, 0)} | вес: ${(done.reduce((s, m) => s + m.bytes, 0) / 1048576).toFixed(1)} МБ`)
