// Диагностика 2: ищем «Dialog body» до и после populate, смотрим поля и родителей
import { readFile } from 'node:fs/promises'

const io = await import('/opt/open-pencil/packages/core/dist/io/index.js')
const kiwi = await import('/opt/open-pencil/packages/core/dist/kiwi/index.js')

const bytes = new Uint8Array(await readFile('/opt/open-pencil/data/ds-unpacked/canvas.fig'))
const registry = new io.IORegistry(io.BUILTIN_IO_FORMATS)
const { graph } = await registry.readDocument({ name: 'canvas.fig', data: bytes })

function describe(node) {
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    componentKey: node.componentKey ?? null,
    sourceLibraryKey: node.sourceLibraryKey ?? null,
    publishId: node.publishId ?? null,
    sourceId: node.source?.id ?? null,
    parentId: node.parentId ?? null
  }
}

function findDialogBody(tag) {
  const hits = []
  for (const node of graph.getAllNodes()) {
    if (node.name === 'Dialog body') hits.push(describe(node))
  }
  console.log(tag, JSON.stringify(hits.slice(0, 10), null, 2))
  return hits.length
}

const before = findDialogBody('=== BEFORE POPULATE (Dialog body) ===')

console.error('populate start...')
const changed = kiwi.populateAllLazyFigImportRoots(graph)
console.error('populate done, changed =', changed)

const after = findDialogBody('=== AFTER POPULATE (Dialog body) ===')

// все компоненты без ключей после populate
let missing = []
for (const node of graph.getAllNodes()) {
  if (node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET') continue
  if (!node.componentKey && !node.sourceLibraryKey && !node.publishId && !node.source?.id) {
    missing.push(describe(node))
  }
}
console.log('=== MISSING AFTER POPULATE ===')
console.log(JSON.stringify({ before, after, missingCount: missing.length, missing: missing.slice(0, 30) }, null, 2))
