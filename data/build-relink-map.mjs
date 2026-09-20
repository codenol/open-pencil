// Карта соответствий: копии в DS ↔ оригиналы в иконочном файле (сопоставление по именам)
import { readFile, writeFile } from 'node:fs/promises'
import { BUILTIN_IO_FORMATS, IORegistry } from '/opt/open-pencil/packages/core/dist/io/index.js'

const io = new IORegistry(BUILTIN_IO_FORMATS)
const icons = await io.readDocument({
  name: 'canvas.fig',
  data: new Uint8Array(await readFile('/opt/open-pencil/data/icons-unpacked/canvas.fig'))
})

const normalize = (name) =>
  name
    .trim()
    .toLowerCase()
    .replace(/^(fi|u|mdi|feather|unicons):/, '')
    .replace(/\s+/g, '-')
    .replace(/-+$/, '')

// индекс оригиналов: нормализованное имя → [{ id, name, type }]
const originals = new Map()
for (const [, node] of icons.graph.nodes) {
  if (node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET') continue
  const key = normalize(node.name)
  if (!key) continue
  if (!originals.has(key)) originals.set(key, [])
  originals.get(key).push({ id: node.id, name: node.name.trim(), type: node.type })
}

// копии из реестра
const registry = JSON.parse(await readFile('/opt/open-pencil/data/ds-structure.json', 'utf8'))
const copies = registry.entities.filter((entity) => entity.external)

const matched = []
const ambiguous = []
const unmatched = []
for (const copy of copies) {
  const key = normalize(copy.name)
  const candidates = originals.get(key) ?? []
  if (candidates.length === 1) {
    matched.push({ copy: { id: copy.id, name: copy.name, page: copy.page }, original: candidates[0], libraryKey: copy.external.libraryKey })
  } else if (candidates.length > 1) {
    ambiguous.push({ copy: { id: copy.id, name: copy.name }, candidates: candidates.slice(0, 3) })
  } else {
    unmatched.push({ id: copy.id, name: copy.name, page: copy.page, libraryKey: copy.external.libraryKey })
  }
}

console.log(`копий в DS: ${copies.length}`)
console.log(`сопоставлено по имени: ${matched.length}`)
console.log(`неоднозначно (несколько кандидатов): ${ambiguous.length}`)
console.log(`не найдено в иконочном файле: ${unmatched.length}`)

console.log('\nпримеры сопоставленных:')
for (const pair of matched.slice(0, 10)) {
  console.log(`  ${pair.copy.name.slice(0, 30).padEnd(30)} → ${pair.original.type === 'COMPONENT_SET' ? 'СЕТ ' : ''}${pair.original.name}`)
}
console.log('\nпримеры не найденных:')
for (const item of unmatched.slice(0, 10)) {
  console.log(`  ${item.name.slice(0, 30).padEnd(30)} [${item.page.slice(0, 24)}] из ${item.libraryKey.slice(0, 14)}…`)
}

await writeFile(
  '/opt/open-pencil/data/relink-map.json',
  JSON.stringify({ generatedAt: new Date().toISOString(), matched, ambiguous, unmatched }, null, 1)
)
console.log('\nсохранено: /opt/open-pencil/data/relink-map.json')
