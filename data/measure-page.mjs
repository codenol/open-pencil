// Замер: сколько весит публикация одной страницы (Buttons)
import { readFile, writeFile } from 'node:fs/promises'

const io = await import('/opt/open-pencil/packages/core/dist/io/index.js')
const kiwi = await import('/opt/open-pencil/packages/core/dist/kiwi/index.js')
const lib = await import('/opt/open-pencil/packages/core/dist/library/index.js')

const bytes = new Uint8Array(await readFile('/opt/open-pencil/data/ds-unpacked/canvas.fig'))
const registry = new io.IORegistry(io.BUILTIN_IO_FORMATS)
const { graph } = await registry.readDocument({ name: 'canvas.fig', data: bytes })

const pageName = process.argv[2] ?? 'Buttons'
const page = graph.getPages().find((p) => p.name.includes(pageName))
if (!page) {
  console.error('Страница не найдена:', pageName)
  process.exit(1)
}
console.error(`page: ${page.name} (${page.id})`)

const started = Date.now()
const changed = kiwi.populateLazyFigImportRoots(graph, [page.id])
console.error(`populate: ${Date.now() - started}ms, changed=${changed}`)

// все компоненты/сеты на странице
const assetIds = []
const walk = (id) => {
  const node = graph.getNode(id)
  if (!node) return
  if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') assetIds.push(node.id)
  for (const childId of node.childIds) walk(childId)
}
for (const childId of page.childIds) walk(childId)
console.error(`assets на странице: ${assetIds.length}`)

const revision = await lib.createLibraryRevision({
  libraryId: 'skala-design-system',
  name: 'Дизайн-система Скала',
  graph,
  description: `Страница ${page.name}`,
  previousRevisionId: null,
  assetNodeIds: assetIds
})

const t0 = Date.now()
const serialized = lib.serializeLibraryRevision(revision)
const json = JSON.stringify(serialized)
console.error(`serialize: ${Date.now() - t0}ms`)
console.log(JSON.stringify({
  page: page.name,
  assets: revision.manifest.assets.length,
  jsonBytes: Buffer.byteLength(json, 'utf8'),
  jsonMB: (Buffer.byteLength(json, 'utf8') / 1024 / 1024).toFixed(1),
  revisionId: revision.manifest.revisionId
}, null, 2))
