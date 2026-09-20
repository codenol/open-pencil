// Связи библиотек: «кнопка» (библиотека A) внутри использует иконку из библиотеки B.
// Что попадает в ревизию A и что потом знает потребитель.
import * as lib from '/opt/open-pencil/packages/core/dist/library/index.js'
import * as sg from '/opt/open-pencil/packages/scene-graph/dist/index.js'

// --- Библиотека B: иконка ---
const g1 = new sg.SceneGraph()
const p1 = g1.getPages()[0].id
// «прогрев» счётчика id, чтобы id снапшота не совпали с исходными
for (let i = 0; i < 30; i += 1) g1.createNode('RECTANGLE', p1, { name: `warmup-${i}`, x: -1000, y: -1000 })
const icon = g1.createNode('COMPONENT', p1, { name: 'icon-wine', x: 0, y: 0 })
const rect = g1.createNode('RECTANGLE', icon.id, { name: 'glyph', x: 0, y: 0 })
g1.updateNode(rect.id, { width: 16, height: 16 })
const rev1 = await lib.createLibraryRevision({
  libraryId: 'icons',
  name: 'Иконки',
  graph: g1,
  assetNodeIds: [icon.id]
})
console.log('ревизия icons:', rev1.manifest.revisionId.slice(0, 10), 'ассеты:', rev1.manifest.assets.map((a) => a.key))
const iconKey = rev1.manifest.assets[0].key

// --- Библиотека A: кнопка, внутри — инстанс иконки из icons ---
const g2 = new sg.SceneGraph()
const p2 = g2.getPages()[0].id
for (let i = 0; i < 30; i += 1) g2.createNode('RECTANGLE', p2, { name: `warmup-${i}`, x: -1000, y: -1000 })
const mat = await lib.materializeLibraryAsset(g2, rev1, iconKey)
console.log('иконка материализована, componentId:', mat.componentId)
const button = g2.createNode('COMPONENT', p2, { name: 'button', x: 200, y: 0 })
const instance = g2.createInstance(mat.componentId, button.id)
g2.updateNode(button.id, { width: 80, height: 32 })

const rev2 = await lib.createLibraryRevision({
  libraryId: 'buttons',
  name: 'Кнопки',
  graph: g2,
  assetNodeIds: [button.id]
})
console.log('ревизия buttons:', rev2.manifest.revisionId.slice(0, 10), 'ассеты:', rev2.manifest.assets.map((a) => a.key))
console.log('enabledLibraries в ревизии buttons:', [...rev2.graph.enabledLibraries.keys()])

// --- Что внутри ревизии buttons? ---
const nodes = []
for (const page of rev2.graph.getPages(true)) {
  for (const id of page.childIds) walk(id)
}
function walk(id, depth = 0) {
  const node = rev2.graph.getNode(id)
  if (!node) return
  nodes.push({
    pad: ' '.repeat(depth),
    type: node.type,
    name: node.name,
    componentId: node.componentId ?? null,
    componentKey: node.componentKey ?? null,
    librarySource: node.librarySource ? `${node.librarySource.identity.libraryId}/${node.librarySource.identity.assetKey}` : null
  })
  for (const child of node.childIds) walk(child, depth + 1)
}
console.log('--- ноды ревизии buttons ---')
for (const n of nodes) console.log(`${n.pad}${n.type} ${n.name} | componentId=${n.componentId} | componentKey=${n.componentKey} | src=${n.librarySource}`)

// --- Проверка: можно ли из ревизии buttons узнать, что нужна библиотека icons ---
const deps = new Set()
for (const page of rev2.graph.getPages(true)) {
  for (const id of page.childIds) collect(id)
}
function collect(id) {
  const node = rev2.graph.getNode(id)
  if (!node) return
  if (node.librarySource?.identity?.libraryId && node.librarySource.identity.libraryId !== 'buttons') {
    deps.add(node.librarySource.identity.libraryId)
  }
  for (const child of node.childIds) collect(child)
}
console.log('внешние зависимости в ревизии buttons:', [...deps])

// --- Потребитель: вставляем кнопку; иконка должна подтянуться из библиотеки icons ---
console.log('')
console.log('=== проверка линковки при вставке ===')
const g3 = new sg.SceneGraph()
const p3 = g3.getPages()[0].id
const buttonKey = rev2.manifest.assets[0].key
const inserted = await lib.materializeLibraryAsset(g3, rev2, buttonKey, {
  resolveRevision: async (libraryId) => (libraryId === 'icons' ? rev1 : libraryId === 'buttons' ? rev2 : null)
})
console.log('вставлен button:', JSON.stringify(inserted))

const report = []
for (const page of g3.getPages(true)) {
  for (const id of page.childIds) walk3(id)
}
function walk3(id, depth = 0) {
  const node = g3.getNode(id)
  if (!node) return
  report.push(`${' '.repeat(depth)}[${node.id}] ${node.type} ${node.name} | componentId=${node.componentId ?? null} | src=${node.librarySource ? `${node.librarySource.identity.libraryId}/${node.librarySource.identity.assetKey}@${node.librarySource.identity.revisionId.slice(0, 8)}` : null}`)
  for (const child of node.childIds) walk3(child, depth + 1)
}
console.log('--- ноды графа-потребителя ---')
for (const line of report) console.log(line)
console.log('enabledLibraries потребителя:', [...g3.enabledLibraries.entries()].map(([k, v]) => `${k}@${v.revisionId.slice(0, 8)}`))
