// Полная цепочка: материализация библиотечной иконки → инстанс → экспорт/импорт
import { readFile } from 'node:fs/promises'
import { BUILTIN_IO_FORMATS, IORegistry } from '/opt/open-pencil/packages/core/dist/io/index.js'
import { exportFigFile } from '/opt/open-pencil/packages/core/dist/io/formats/fig/index.js'
import * as lib from '/opt/open-pencil/packages/core/dist/library/index.js'
import * as sg from '/opt/open-pencil/packages/scene-graph/dist/index.js'
import { decodeLibraryValue } from '/opt/open-pencil/packages/core/dist/library/index.js'

const CATALOG = '/opt/open-pencil/data/site-library-catalog-archive'
const libraryId = 'skala-icons'
const manifest = JSON.parse(await readFile(`${CATALOG}/${libraryId}/manifest.json`, 'utf8'))
const revisionId = manifest.summary.latestRevisionId
const stored = decodeLibraryValue(
  JSON.parse(await readFile(`${CATALOG}/${libraryId}/revisions/${revisionId}.json`, 'utf8'))
)
const revision = lib.deserializeLibraryRevision(stored)

// новый пустой документ
const graph = new sg.SceneGraph()
const pageId = graph.getPages()[0].id

// 1) вставка из библиотеки (как панель: materialize → createInstance)
const asset = revision.manifest.assets[0]
const materialized = lib.materializeLibraryAsset(graph, revision, asset.key)
console.log('materialized:', JSON.stringify(materialized))
const instance = graph.createInstance(materialized.componentId, pageId)
console.log('инстанс:', instance?.id, 'componentId =', instance?.componentId ?? 'null')

// 2) экспорт → импорт
const exported = await exportFigFile(graph)
const bytes = new Uint8Array(exported)
const io = new IORegistry(BUILTIN_IO_FORMATS)
const again = await io.readDocument({ name: 'x.fig', data: bytes })
const instances = [...again.graph.nodes.values()].filter((n) => n.type === 'INSTANCE')
for (const inst of instances) {
  const comp = inst.componentId ? again.graph.getNode(inst.componentId) : null
  console.log(`после round-trip: ${inst.id} "${inst.name}" componentId=${inst.componentId ?? 'null'} → ${comp ? `${comp.type} "${comp.name}"` : 'НЕ НАЙДЕН'}`)
}
