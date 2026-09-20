// Нарезка «только компоненты»: из страницы берём компоненты/сеты и их содержимое,
// макеты-примеры, тексты-объяснялки и прочий мусор выкидываем.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import * as figPkg from '/opt/open-pencil/packages/fig/dist/index.js'
import * as corePkg from '/opt/open-pencil/packages/core/dist/index.js'
import { exportFigFile } from '/opt/open-pencil/packages/core/dist/io/formats/fig/index.js'
import { SceneGraph } from '/opt/open-pencil/packages/scene-graph/dist/index.js'

const SOURCE = '/opt/open-pencil/data/ds-unpacked/canvas.fig'
const OUT_DIR = '/opt/open-pencil/data/ds-final'

await mkdir(OUT_DIR, { recursive: true })
const bytes = new Uint8Array(await readFile(SOURCE))
const parsed = figPkg.parseFigBuffer(bytes.buffer)
const full = corePkg.importNodeChanges(parsed.nodeChanges, parsed.blobs, new Map(parsed.images), {
  populate: 'none'
})

const countTree = (id) => {
  let count = 0
  const stack = [id]
  while (stack.length > 0) {
    const node = full.getNode(stack.pop())
    if (!node) continue
    count += 1
    for (const child of node.childIds) stack.push(child)
  }
  return count
}

/**
 * Собирает граф из указанных «корней» (компоненты/сеты или их контейнеры),
 * беря их целиком, но не захватывая соседние макеты-примеры.
 */
function componentGraph(roots, pageName) {
  const keep = new Set([full.rootId, ...roots])
  const queue = [...roots]
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
      return node?.type === 'CANVAS' && node.name?.trim() === pageName
    })
  }
  return sub
}

/** Собирает поддерево по контейнеру верхнего уровня, оставляя только компоненты/сеты внутри. */
function componentsInside(containerId) {
  const found = []
  const walk = (id) => {
    const node = full.getNode(id)
    if (!node) return
    if (node.type === 'COMPONENT_SET' || node.type === 'COMPONENT') {
      found.push(id)
      return // внутрь компонента не идём — заберём его целиком позже
    }
    for (const child of node.childIds) walk(child)
  }
  walk(containerId)
  // варианты внутри сета не берём как отдельные корни
  return found.filter((id) => {
    const node = full.getNode(id)
    if (!node?.parentId) return true
    return full.getNode(node.parentId)?.type !== 'COMPONENT_SET'
  })
}

const pageByName = (fragment) =>
  full.getPages(true).find((page) => !page.internalOnly && page.name.includes(fragment))

const manifest = []
async function save(fileName, roots, pageName, label) {
  const nodes = roots.reduce((sum, id) => sum + countTree(id), 0)
  try {
    const sub = componentGraph(roots, pageName)
    const out = await exportFigFile(sub, undefined, undefined, full.getPages(true).find((p) => p.name.trim() === pageName)?.childIds[0] ?? roots[0])
    await writeFile(`${OUT_DIR}/${fileName}`, out)
    manifest.push({ label, file: fileName, roots: roots.length, nodes, bytes: out.byteLength })
    console.log(`  ${String(roots.length).padStart(4)} комп. / ${String(nodes).padStart(5)} нод → ${fileName} (${Math.round(out.byteLength / 1024)} КБ)`)
  } catch (error) {
    manifest.push({ label, file: fileName, roots: roots.length, nodes, error: String(error).slice(0, 130) })
    console.log(`  ОШИБКА ${fileName}: ${String(error).slice(0, 100)}`)
  }
}

// --- Buttons: только сет(ы) компонентов ---
const buttons = pageByName('Buttons')
if (buttons) {
  console.log('\nButtons: оставляю только компоненты')
  // компоненты ищем по всей странице (могут лежать внутри фреймов)
  const roots = []
  for (const childId of buttons.childIds) {
    const node = full.getNode(childId)
    if (!node) continue
    if (node.type === 'COMPONENT_SET' || node.type === 'COMPONENT') roots.push(childId)
    else roots.push(...componentsInside(childId))
  }
  const uniqueRoots = [...new Set(roots)].filter((id) => {
    const node = full.getNode(id)
    return node && !(node.parentId && full.getNode(node.parentId)?.type === 'COMPONENT_SET')
  })
  console.log(`  компонентов найдено: ${uniqueRoots.length} (всего нод на странице ${countTree(buttons.id)})`)
  await save('Buttons.fig', uniqueRoots, buttons.name.trim(), 'Buttons (только компоненты)')
}

// --- Layout: три части — sidebar, breadcrumbs, layout ---
const layout = pageByName('Layout')
if (layout) {
  console.log('\nLayout: режу на три части')
  const groups = { sidebar: [], breadcrumbs: [], layout: [] }
  for (const childId of layout.childIds) {
    const node = full.getNode(childId)
    if (!node) continue
    const name = node.name.trim().toLowerCase()
    const inside = componentsInside(childId)
    if (inside.length === 0) continue
    if (name.includes('sidebar')) groups.sidebar.push(...inside)
    else if (name.includes('breadcrumb')) groups.breadcrumbs.push(...inside)
    else groups.layout.push(...inside)
  }
  // компоненты верхнего уровня самой страницы
  for (const childId of layout.childIds) {
    const node = full.getNode(childId)
    if (!node) continue
    if (node.type === 'COMPONENT_SET' || node.type === 'COMPONENT') groups.layout.push(childId)
  }
  for (const [part, roots] of Object.entries(groups)) {
    if (roots.length === 0) { console.log(`  ${part}: компонентов нет`); continue }
    await save(`Layout-${part}.fig`, roots, layout.name.trim(), `Layout — ${part}`)
  }
}

// --- Modal ---
const modal = pageByName('Modal')
if (modal) {
  console.log('\nModal: оставляю только компоненты')
  const roots = []
  for (const childId of modal.childIds) {
    const node = full.getNode(childId)
    if (!node) continue
    if (node.type === 'COMPONENT_SET' || node.type === 'COMPONENT') roots.push(childId)
    else roots.push(...componentsInside(childId))
  }
  const unique = [...new Set(roots)].filter((id) => {
    const node = full.getNode(id)
    return node && !(node.parentId && full.getNode(node.parentId)?.type === 'COMPONENT_SET')
  })
  await save('Modal.fig', unique, modal.name.trim(), 'Modal (только компоненты)')
}

await writeFile(`${OUT_DIR}/manifest.json`, JSON.stringify({ source: SOURCE, files: manifest }, null, 1))
const done = manifest.filter((m) => m.bytes)
console.log(`\nфайлов: ${done.length} | нод: ${done.reduce((s, m) => s + m.nodes, 0)} | вес: ${(done.reduce((s, m) => s + m.bytes, 0) / 1048576).toFixed(2)} МБ`)
