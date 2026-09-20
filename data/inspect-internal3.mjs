// Копии или варианты: сверяю служебные сеты с рабочими по componentKey и sourceLibraryKey
import { readFile } from 'node:fs/promises'
import { BUILTIN_IO_FORMATS, IORegistry } from '/opt/open-pencil/packages/core/dist/io/index.js'

const io = new IORegistry(BUILTIN_IO_FORMATS)
const { graph } = await io.readDocument({
  name: 'canvas.fig',
  data: new Uint8Array(await readFile('/opt/open-pencil/data/ds-unpacked/canvas.fig'))
})

const pages = graph.getPages(true)
const pageOf = (nodeId) => {
  const pageIds = new Set(pages.map((p) => p.id))
  let current = graph.getNode(nodeId)
  while (current) {
    if (pageIds.has(current.id)) return current
    current = current.parentId ? graph.getNode(current.parentId) : undefined
  }
  return undefined
}
const internalPage = pages.find((p) => p.internalOnly)

function collect(rootIds, filter) {
  const found = []
  const visited = new Set()
  const pending = [...rootIds]
  while (pending.length > 0) {
    const id = pending.pop()
    if (!id || visited.has(id)) continue
    visited.add(id)
    const node = graph.getNode(id)
    if (!node) continue
    if (filter(node)) found.push(node)
    pending.push(...node.childIds)
  }
  return found
}

const isSet = (n) => n.type === 'COMPONENT_SET'
const internalSets = collect(internalPage?.childIds ?? [], isSet)
const workingSets = []
for (const page of pages) {
  if (page.internalOnly) continue
  workingSets.push(...collect(page.childIds, isSet).map((node) => ({ node, page })))
}

console.log('сетов на служебной:', internalSets.length, '| на рабочих:', workingSets.length)

console.log('\nслужебные сеты (примеры):')
for (const node of internalSets.slice(0, 15)) {
  console.log(`  ${node.name.slice(0, 34).padEnd(34)} componentKey=${(node.componentKey ?? '-').slice(0, 12)} publishId=${(node.publishId ?? '-').slice(0, 12)}`)
}

console.log('\nрабочие сеты (примеры):')
for (const { node, page } of workingSets.slice(0, 15)) {
  console.log(`  ${node.name.slice(0, 34).padEnd(34)} [${page.name.slice(0, 22)}] componentKey=${(node.componentKey ?? '-').slice(0, 12)} publishId=${(node.publishId ?? '-').slice(0, 12)}`)
}

// пересечение по componentKey
const workingKeys = new Set(workingSets.map(({ node }) => node.componentKey).filter(Boolean))
let same = 0
for (const node of internalSets) {
  if (node.componentKey && workingKeys.has(node.componentKey)) same += 1
}
console.log('\nслужебных сетов с тем же componentKey, что у рабочих:', same, 'из', internalSets.length)

// sourceLibraryKey: сколько РАЗНЫХ библиотек-источников
const libraryKeys = new Map()
for (const [, node] of graph.nodes) {
  if (!node.sourceLibraryKey) continue
  libraryKeys.set(node.sourceLibraryKey, (libraryKeys.get(node.sourceLibraryKey) ?? 0) + 1)
}
console.log('\nбиблиотек-источников (sourceLibraryKey) в файле:', libraryKeys.size)
for (const [key, count] of [...libraryKeys.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
  console.log(`  ${key.slice(0, 24)}…: ${count} нод`)
}

// иконки fi:/u: — их sourceLibraryKey
console.log('\nиконки fi:/u: (куда ссылаются):')
for (const [, node] of graph.nodes) {
  if (/^(fi|u):/.test(node.name) && node.sourceLibraryKey) {
    console.log(`  ${node.name} → ${node.sourceLibraryKey.slice(0, 24)}… | publishId=${(node.publishId ?? '-').slice(0, 12)}`)
  }
}
