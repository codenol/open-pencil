// Публикация дизайн-системы Скалы в каталог: один populate, N библиотек по смысловым разделам
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const io = await import('/opt/open-pencil/packages/core/dist/io/index.js')
const kiwi = await import('/opt/open-pencil/packages/core/dist/kiwi/index.js')
const lib = await import('/opt/open-pencil/packages/core/dist/library/index.js')

const ROOT = '/opt/open-pencil/data/library-catalog'
const SRC = '/opt/open-pencil/data/ds-unpacked/canvas.fig'

const EXCLUDE = ['Tests', 'Internal', 'draft', 'Heat map', 'Cover', 'Guidelines', 'Color', 'Dimensions', 'Data table', 'Layout new slot']

const GROUPS = [
  { id: 'skala-ds-buttons', name: 'Скала: Кнопки и действия', pages: ['Buttons', 'Toggle button', 'Option-switcher', 'Chip', 'Progress', 'Divider'] },
  { id: 'skala-ds-forms', name: 'Скала: Формы и поля', pages: ['Input', 'Textarea', 'Checkbox', 'RadioButton', 'Switch', 'Datepicker', 'Uploading', 'Input Number', 'Input Password', 'Input Search'] },
  { id: 'skala-ds-navigation', name: 'Скала: Навигация и каркас', pages: ['Layout', 'Sidebar', 'breadcrumbs', 'Tabs', 'Pagination', 'Stepper', 'Scrollbar', 'Zoom', 'Toolbar'] },
  { id: 'skala-ds-data', name: 'Скала: Данные и таблицы', pages: ['Table', 'Dropdown', 'list', 'Status', 'Indicator', 'Badges'] },
  { id: 'skala-ds-overlays', name: 'Скала: Оверлеи и уведомления', pages: ['Modal', 'Drawer', 'Toast', 'Tooltip', 'Toggletip', 'Message', 'Dialog'] },
]

const bytes = new Uint8Array(await readFile(SRC))
const registry = new io.IORegistry(io.BUILTIN_IO_FORMATS)
const { graph } = await registry.readDocument({ name: 'ds.fig', data: bytes })

console.error('populate...')
const t0 = Date.now()
kiwi.populateAllLazyFigImportRoots(graph)
console.error(`populate done: ${((Date.now() - t0) / 1000).toFixed(0)}s`)

const pages = graph.getPages().filter((page) => !EXCLUDE.some((skip) => page.name.includes(skip)))
const byPage = new Map()
for (const page of pages) {
  const ids = []
  const seen = new Set()
  const walk = (id) => {
    const node = graph.getNode(id)
    if (!node || seen.has(id)) return
    seen.add(id)
    if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
      const parent = node.parentId ? graph.getNode(node.parentId) : null
      if (parent?.type !== 'COMPONENT_SET') ids.push(node.id)
    }
    for (const childId of node.childIds) walk(childId)
  }
  for (const childId of page.childIds) walk(childId)
  if (ids.length) byPage.set(page.name, ids)
}

const usedPages = new Set()
const summaries = []
for (const group of GROUPS) {
  const ids = []
  for (const [pageName, pageIds] of byPage) {
    if (group.pages.some((needle) => pageName.includes(needle))) {
      ids.push(...pageIds)
      usedPages.add(pageName)
    }
  }
  if (!ids.length) {
    console.error(`skip ${group.id}: нет ассетов`)
    continue
  }
  const started = Date.now()
  const revision = await lib.createLibraryRevision({
    libraryId: group.id,
    name: group.name,
    graph,
    description: '',
    previousRevisionId: null,
    assetNodeIds: ids
  })
  const json = JSON.stringify(lib.encodeLibraryValue(lib.serializeLibraryRevision(revision)))
  const dir = resolve(ROOT, group.id, 'revisions')
  await mkdir(dir, { recursive: true })
  const revisionId = revision.manifest.revisionId
  await writeFile(resolve(dir, `${revisionId}.json`), json)
  const groupSummary = {
    libraryId: group.id,
    name: group.name,
    latestRevisionId: revisionId,
    publishedAt: revision.manifest.publishedAt,
    assetCount: revision.manifest.assets.length
  }
  await writeFile(
    resolve(ROOT, group.id, 'manifest.json'),
    JSON.stringify({ schemaVersion: 1, summary: groupSummary })
  )
  summaries.push(groupSummary)
  console.error(`✓ ${group.name}: ${revision.manifest.assets.length} ассетов, ${(json.length / 1024 / 1024).toFixed(1)} МБ, ${((Date.now() - started) / 1000).toFixed(0)}s`)
}

// хвост: неиспользованные непустые страницы → «Прочее»
const restIds = []
for (const [pageName, pageIds] of byPage) {
  if (!usedPages.has(pageName)) restIds.push(...pageIds)
}
if (restIds.length) {
  const revision = await lib.createLibraryRevision({
    libraryId: 'skala-ds-misc',
    name: 'Скала: Прочее',
    graph,
    description: '',
    previousRevisionId: null,
    assetNodeIds: restIds
  })
  const json = JSON.stringify(lib.encodeLibraryValue(lib.serializeLibraryRevision(revision)))
  const dir = resolve(ROOT, 'skala-ds-misc', 'revisions')
  await mkdir(dir, { recursive: true })
  await writeFile(resolve(dir, `${revision.manifest.revisionId}.json`), json)
  await writeFile(
    resolve(ROOT, 'skala-ds-misc', 'manifest.json'),
    JSON.stringify({ schemaVersion: 1, summary: { libraryId: 'skala-ds-misc', name: 'Скала: Прочее', latestRevisionId: revision.manifest.revisionId, publishedAt: revision.manifest.publishedAt, assetCount: revision.manifest.assets.length } })
  )
  summaries.push({ libraryId: 'skala-ds-misc', name: 'Скала: Прочее', latestRevisionId: revision.manifest.revisionId, publishedAt: revision.manifest.publishedAt, assetCount: revision.manifest.assets.length })
  console.error(`✓ Скала: Прочее: ${revision.manifest.assets.length} ассетов, ${(json.length / 1024 / 1024).toFixed(1)} МБ`)
}

// переписываем libraries.json: иконки + разделы
const existingRaw = JSON.parse(await readFile(resolve(ROOT, 'libraries.json'), 'utf8'))
const icons = existingRaw.filter((item) => item.libraryId === 'skala-icons')
const all = [...icons, ...summaries]
await writeFile(resolve(ROOT, 'libraries.json'), JSON.stringify(all, null, 2))
console.error('libraries.json обновлён:', all.map((item) => item.libraryId).join(', '))
console.log(JSON.stringify(all, null, 2))
