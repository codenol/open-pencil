// Сценарий Сергея: сет «icon» с вариантами, внутри инстансы иконки → экспорт/импорт
import { readFile } from 'node:fs/promises'
import * as lib from '/opt/open-pencil/packages/core/dist/library/index.js'
import * as sg from '/opt/open-pencil/packages/scene-graph/dist/index.js'
import { BUILTIN_IO_FORMATS, IORegistry } from '/opt/open-pencil/packages/core/dist/io/index.js'
import { exportFigFile } from '/opt/open-pencil/packages/core/dist/io/formats/fig/index.js'

const CATALOG = '/opt/open-pencil/data/site-library-catalog-archive'
const manifest = JSON.parse(await readFile(`${CATALOG}/skala-icons/manifest.json`, 'utf8'))
const stored = lib.decodeLibraryValue(
  JSON.parse(
    await readFile(`${CATALOG}/skala-icons/revisions/${manifest.summary.latestRevisionId}.json`, 'utf8')
  )
)
const revision = lib.deserializeLibraryRevision(stored)

const graph = new sg.SceneGraph()
const pageId = graph.getPages()[0].id

// 1) материализуем wine (assetKey 60:27391)
const materialized = lib.materializeLibraryAsset(graph, revision, '60:27391')
console.log('materialized wine:', JSON.stringify(materialized))

// 2) сет icon с двумя вариантами, внутри — инстансы wine
const set = graph.createNode('COMPONENT_SET', pageId, { name: 'icon', x: 0, y: 0 })
const v1 = graph.createNode('COMPONENT', set.id, { name: 'Size=16', x: 0, y: 0 })
const v2 = graph.createNode('COMPONENT', set.id, { name: 'Size=24', x: 120, y: 0 })
const i1 = graph.createInstance(materialized.componentId, v1.id)
const i2 = graph.createInstance(materialized.componentId, v2.id)
console.log('инстансы:', i1?.id, i2?.id, '| componentId:', i1?.componentId, i2?.componentId)

// 3) экспорт → импорт
const bytes = new Uint8Array(await exportFigFile(graph))
const io = new IORegistry(BUILTIN_IO_FORMATS)
const again = await io.readDocument({ name: 'x.fig', data: bytes })
console.log('\n--- после round-trip ---')
for (const node of again.graph.nodes.values()) {
  if (node.type === 'INSTANCE') {
    const comp = node.componentId ? again.graph.getNode(node.componentId) : null
    console.log(`INSTANCE ${node.id} "${node.name}" parent=${node.parentId} componentId=${node.componentId || 'NULL'} → ${comp ? comp.type + ' "' + comp.name + '"' : 'НЕ НАЙДЕН'}`)
  }
  if (node.type === 'COMPONENT_SET' || node.type === 'COMPONENT') {
    console.log(`${node.type} ${node.id} "${node.name}"`)
  }
}
