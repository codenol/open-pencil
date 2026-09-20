// Экспорт «только компонентов»: служебная страница Figma — там лежат сами компоненты
// (рабочие страницы — витрины, они не нужны). Режем на части по размеру.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import * as figPkg from '/opt/open-pencil/packages/fig/dist/index.js'
import * as corePkg from '/opt/open-pencil/packages/core/dist/index.js'
import { exportFigFile } from '/opt/open-pencil/packages/core/dist/io/formats/fig/index.js'
import { SceneGraph } from '/opt/open-pencil/packages/scene-graph/dist/index.js'

const SOURCE = '/opt/open-pencil/data/ds-unpacked/canvas.fig'
const OUT_DIR = '/opt/open-pencil/data/ds-components'
const MAX_NODES = Number(process.argv[2] ?? 2400)

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

/** Граф из корней (компонентов) + документ с одной страницей-носителем. */
function graphFor(roots) {
  // страница-носитель: у компонентов со служебной страницы нужен родительский CANVAS
  const carrier = full.getPages(true).find((page) => page.internalOnly)
  const keep = new Set([full.rootId, ...(carrier ? [carrier.id] : []), ...roots])
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
  // Переменные (токены) и коллекции: забираем те, на которые ссылаются наши компоненты,
  // иначе привязки «заливка → токен» теряются при выгрузке.
  const usedVariableIds = new Set()
  for (const id of keep) {
    const node = full.nodes.get(id)
    const bv = node?.boundVariables
    if (!bv) continue
    for (const value of bv instanceof Map ? bv.values() : Object.values(bv)) {
      const entries = Array.isArray(value) ? value : [value]
      for (const entry of entries) {
        const varId = typeof entry === 'string' ? entry : entry?.id ?? entry?.variableId
        if (varId) usedVariableIds.add(varId)
      }
    }
  }
  // Добираем по цепочке: токен может ссылаться на другой токен (алиасы),
  // поэтому идём по значениям, пока не соберём все нужные переменные.
  const aliasQueue = [...usedVariableIds]
  while (aliasQueue.length > 0) {
    const varId = aliasQueue.pop()
    const variable = full.variables.get(varId)
    if (!variable) continue
    for (const value of Object.values(variable.valuesByMode ?? {})) {
      const entries = Array.isArray(value) ? value : [value]
      for (const entry of entries) {
        const aliasId = entry && typeof entry === 'object' ? entry.variableId ?? entry.id : null
        if (aliasId && !usedVariableIds.has(aliasId)) {
          usedVariableIds.add(aliasId)
          aliasQueue.push(aliasId)
        }
      }
    }
  }
  const collectionIds = new Set()
  for (const varId of usedVariableIds) {
    const variable = full.variables.get(varId)
    if (variable) collectionIds.add(variable.collectionId)
  }
  // Коллекции тянем целиком: их режимы (Light/Dark) нужны для разрешения значений.
  const variableIdsOfCollections = new Set()
  for (const [, collection] of full.variableCollections) {
    if (!collectionIds.has(collection.id)) continue
    for (const id of collection.variableIds ?? []) variableIdsOfCollections.add(id)
  }
  for (const id of variableIdsOfCollections) {
    const variable = full.variables.get(id)
    if (variable) usedVariableIds.add(id)
  }
  // В файлах Figma встречаются привязки на переменные, которых нет в списке коллекции
  // (неявные). Добираем всё, что относится к нужным коллекциям, — иначе импорт падает.
  for (const [id, variable] of full.variables) {
    if (collectionIds.has(variable.collectionId)) usedVariableIds.add(id)
  }
  for (const [id, variable] of full.variables) {
    if (!usedVariableIds.has(id)) continue
    sub.variables.set(id, variable)
  }
  for (const [id, collection] of full.variableCollections) {
    if (!collectionIds.has(id)) continue
    sub.variableCollections.set(id, collection)
  }
  for (const [modeId, value] of full.activeMode) {
    if (modeId) sub.activeMode.set(modeId, value)
  }
  for (const [id, node] of full.nodes) {
    if (!keep.has(id)) continue
    // страница-носитель становится обычной страницей с понятным именем:
    // служебное имя Figma («Internal Only Canvas») сбивает и редактор, и человека
    const patched =
      node.type === 'CANVAS'
        ? { ...node, internalOnly: false, name: 'Компоненты', sharedStyleType: null }
        : node
    sub.nodes.set(id, { ...patched, childIds: node.childIds.filter((c) => keep.has(c)) })
  }
  for (const [id, ids] of full.instanceIndex) {
    if (!keep.has(id)) continue
    sub.instanceIndex.set(id, new Set([...ids].filter((i) => keep.has(i))))
  }
  return sub
}

// 1) собираем «свои» компоненты со служебной страницы
const internal = full.getPages(true).find((page) => page.internalOnly)
const own = []
const walk = (id) => {
  const node = full.getNode(id)
  if (!node) return
  if (node.type === 'COMPONENT_SET' || node.type === 'COMPONENT') {
    if (!node.sourceLibraryKey && !node.publishId) own.push(id)
    return
  }
  for (const child of node.childIds) walk(child)
}
for (const id of internal.childIds) walk(id)
// варианты внутри сетов не берём корнями
const roots = own.filter((id) => {
  const node = full.getNode(id)
  return !(node?.parentId && full.getNode(node.parentId)?.type === 'COMPONENT_SET')
})
console.log(`своих компонентов-корней: ${roots.length} (всего нод ${roots.reduce((s, id) => s + countTree(id), 0)})`)

// 2) раскладываем по частям
const chunks = []
let current = { roots: [], nodes: 0 }
for (const id of roots.sort((a, b) => countTree(b) - countTree(a))) {
  const nodes = countTree(id)
  if (current.nodes + nodes > MAX_NODES && current.roots.length > 0) {
    chunks.push(current)
    current = { roots: [], nodes: 0 }
  }
  current.roots.push(id)
  current.nodes += nodes
}
if (current.roots.length > 0) chunks.push(current)

const manifest = []
for (let index = 0; index < chunks.length; index += 1) {
  const chunk = chunks[index]
  const names = chunk.roots.slice(0, 3).map((id) => full.getNode(id)?.name?.trim().slice(0, 16)).join('_')
  const fileName = `components-${index + 1}.fig`
  try {
    const sub = graphFor(chunk.roots)
    const out = await exportFigFile(sub, undefined, undefined, chunk.roots[0], false, { noImplicitInternalCanvas: true })
    await writeFile(`${OUT_DIR}/${fileName}`, out)
    manifest.push({ file: fileName, components: chunk.roots.length, nodes: chunk.nodes, bytes: out.byteLength, preview: names, variables: sub.variables.size, collections: sub.variableCollections.size })
    console.log(`  часть ${index + 1}: ${String(chunk.roots.length).padStart(3)} комп. / ${String(chunk.nodes).padStart(5)} нод / токенов ${sub.variables.size} (${Math.round(out.byteLength / 1024)} КБ) — ${names}`)
  } catch (error) {
    manifest.push({ file: fileName, components: chunk.roots.length, nodes: chunk.nodes, error: String(error).slice(0, 130) })
    console.log(`  часть ${index + 1}: ОШИБКА ${String(error).slice(0, 100)}`)
  }
}

await writeFile(`${OUT_DIR}/manifest.json`, JSON.stringify({ source: SOURCE, maxNodes: MAX_NODES, files: manifest }, null, 1))
const done = manifest.filter((m) => m.bytes)
console.log(`\nфайлов: ${done.length} | компонентов: ${done.reduce((s, m) => s + m.components, 0)} | нод: ${done.reduce((s, m) => s + m.nodes, 0)} | вес: ${(done.reduce((s, m) => s + m.bytes, 0) / 1048576).toFixed(2)} МБ`)
