// Публикует дизайн-систему «Скала» как библиотеку: компоненты из выгруженных файлов
// собираются в один граф и публикуются. Библиотеку потом можно подключить в любом
// файле — компоненты появятся в панели ассетов.
import { readFile } from 'node:fs/promises'

import * as figPkg from '/opt/open-pencil/packages/fig/dist/index.js'
import * as corePkg from '/opt/open-pencil/packages/core/dist/index.js'
import * as lib from '/opt/open-pencil/packages/core/dist/library/index.js'
import { SceneGraph } from '/opt/open-pencil/packages/scene-graph/dist/index.js'

const BASE = 'https://html.norka.cc/api'
const LIBRARY_ID = 'skala-ds'
const LIBRARY_NAME = 'ДС Скала'
const SOURCES = [
  '/opt/open-pencil/data/ds-components/components-1.fig',
  '/opt/open-pencil/data/ds-components/components-2.fig'
]

async function upload(key, body) {
  const response = await fetch(`${BASE}/objects?key=${encodeURIComponent(key)}`, {
    method: 'PUT',
    body
  })
  if (!response.ok) throw new Error(`upload ${key}: ${response.status}`)
}

// 1) Собираем все компоненты в один граф
const target = new SceneGraph()
const pageId = target.getPages()[0].id
const assetIds = []
let copied = 0

for (const file of SOURCES) {
  const bytes = new Uint8Array(await readFile(file))
  const parsed = figPkg.parseFigBuffer(bytes.buffer)
  const source = corePkg.importNodeChanges(parsed.nodeChanges, parsed.blobs, new Map(parsed.images), {
    populate: 'none'
  })
  // корневые компоненты (не варианты внутри сета)
  const roots = []
  for (const node of source.getAllNodes()) {
    if (node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET') continue
    if (node.parentId && source.getNode(node.parentId)?.type === 'COMPONENT_SET') continue
    roots.push(node.id)
  }
  // Переменные (токены) переносим вместе с компонентами: без них заливки,
  // привязанные к токенам, теряются и секция Fill у компонентов пустая.
  for (const [id, variable] of source.variables) target.variables.set(id, variable)
  for (const [id, collection] of source.variableCollections) {
    target.variableCollections.set(id, collection)
  }
  for (const [modeId, value] of source.activeMode) target.activeMode.set(modeId, value)

  // Переносим поддеревья в общий граф. Копируем только переносимые поля:
  // createNode сам выдаёт id и выставляет родителя.
  const TRANSIENT = new Set(['id', 'parentId', 'childIds', 'source'])
  const copyTree = (nodeId, parentId) => {
    const node = source.getNode(nodeId)
    if (!node) return null
    const props = {}
    for (const [key, value] of Object.entries(node)) {
      if (TRANSIENT.has(key) || value === undefined) continue
      props[key] = value
    }
    const created = target.createNode(node.type, parentId, props)
    for (const childId of node.childIds) copyTree(childId, created.id)
    return created
  }
  for (const rootId of roots) {
    const created = copyTree(rootId, pageId)
    if (created) {
      assetIds.push(created.id)
      copied += 1
    }
  }
  console.log(`${file.split('/').pop()}: компонентов ${roots.length}`)
}

console.log(`скопировано в библиотеку: ${copied}`)

// 2) Публикуем
const revision = await lib.createLibraryRevision({
  libraryId: LIBRARY_ID,
  name: LIBRARY_NAME,
  graph: target,
  assetNodeIds: assetIds,
  description: 'Дизайн-система «Скала»: компоненты, привязки к токенам'
})

const m = revision.manifest
await upload(
  `open-pencil/libraries/${m.libraryId}/revisions/${m.revisionId}.json`,
  JSON.stringify(lib.encodeLibraryValue(lib.serializeLibraryRevision(revision)))
)
await upload(
  `open-pencil/libraries/${m.libraryId}/manifest.json`,
  JSON.stringify({
    schemaVersion: 1,
    summary: {
      libraryId: m.libraryId,
      name: m.name,
      latestRevisionId: m.revisionId,
      publishedAt: m.publishedAt,
      assetCount: m.assets.length
    }
  })
)
console.log(`\nопубликовано: ${m.name}`)
console.log(`  ассетов: ${m.assets.length}`)
console.log(`  ревизия: ${m.revisionId.slice(0, 16)}`)
