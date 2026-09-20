// Замер всех страниц: сколько весит публикация каждой по отдельности
import { readFile } from 'node:fs/promises'

const io = await import('/opt/open-pencil/packages/core/dist/io/index.js')
const kiwi = await import('/opt/open-pencil/packages/core/dist/kiwi/index.js')
const lib = await import('/opt/open-pencil/packages/core/dist/library/index.js')

const bytes = new Uint8Array(await readFile('/opt/open-pencil/data/ds-unpacked/canvas.fig'))
const registry = new io.IORegistry(io.BUILTIN_IO_FORMATS)
const { graph } = await registry.readDocument({ name: 'canvas.fig', data: bytes })

const SKIP = /Tests|Internal|draft|Heat map|Cover|Guidelines|Color|Dimensions|Layout new slot|Typography|Data table/i
const pages = graph.getPages().filter((page) => {
  if (SKIP.test(page.name)) return false
  let has = false
  const walk = (id) => {
    const node = graph.getNode(id)
    if (!node) return
    if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') has = true
    if (!has) for (const childId of node.childIds) walk(childId)
  }
  for (const childId of page.childIds) { walk(childId); if (has) break }
  return has
})

console.error(`Страниц к замеру: ${pages.length}`)
const results = []
for (const page of pages) {
  const started = Date.now()
  const assetIds = []
  const walk = (id) => {
    const node = graph.getNode(id)
    if (!node) return
    if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') assetIds.push(node.id)
    for (const childId of node.childIds) walk(childId)
  }
  for (const childId of page.childIds) walk(childId)
  try {
    const revision = await lib.createLibraryRevision({
      libraryId: 'skala-design-system',
      name: 'Дизайн-система Скала',
      graph,
      description: page.name,
      previousRevisionId: null,
      assetNodeIds: assetIds
    })
    const json = JSON.stringify(lib.serializeLibraryRevision(revision))
    const mb = Buffer.byteLength(json, 'utf8') / 1024 / 1024
    results.push({ page: page.name.trim(), assets: revision.manifest.assets.length, mb: Number(mb.toFixed(1)), ms: Date.now() - started })
    console.error(`✓ ${page.name.trim()}: ${revision.manifest.assets.length} assets, ${mb.toFixed(1)} MB, ${Date.now() - started}ms`)
  } catch (error) {
    results.push({ page: page.name.trim(), error: String(error?.message ?? error) })
    console.error(`✗ ${page.name.trim()}: ${error?.message ?? error}`)
  }
}

results.sort((a, b) => (b.mb ?? -1) - (a.mb ?? -1))
console.log(JSON.stringify(results, null, 2))
const total = results.reduce((sum, r) => sum + (r.mb ?? 0), 0)
console.log(`ИТОГО: ${total.toFixed(1)} MB по ${results.length} страницам`)
