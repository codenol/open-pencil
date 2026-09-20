// Разбор: что на служебной странице — копии чужих компонентов или варианты?
import { readFile } from 'node:fs/promises'
import { BUILTIN_IO_FORMATS, IORegistry } from '/opt/open-pencil/packages/core/dist/io/index.js'

const io = new IORegistry(BUILTIN_IO_FORMATS)
const { graph } = await io.readDocument({
  name: 'canvas.fig',
  data: new Uint8Array(await readFile('/opt/open-pencil/data/ds-unpacked/canvas.fig'))
})

const internalPage = graph.getPages(true).find((p) => p.internalOnly)
const pageOf = (nodeId) => {
  const pageIds = new Set(graph.getPages(true).map((p) => p.id))
  let current = graph.getNode(nodeId)
  while (current) {
    if (pageIds.has(current.id)) return current
    current = current.parentId ? graph.getNode(current.parentId) : undefined
  }
  return undefined
}

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

const isComponent = (n) => n.type === 'COMPONENT' || n.type === 'COMPONENT_SET'
const onInternal = collect(internalPage?.childIds ?? [], isComponent)

// 1) Ключи: sourceLibraryKey / publishId / componentKey у служебных компонентов
let withSourceKey = 0
let withPublishId = 0
let withComponentKey = 0
for (const node of onInternal) {
  if (node.sourceLibraryKey) withSourceKey += 1
  if (node.publishId) withPublishId += 1
  if (node.componentKey) withComponentKey += 1
}
console.log(`служебных компонентов: ${onInternal.length}`)
console.log(`  со sourceLibraryKey: ${withSourceKey}, с publishId: ${withPublishId}, с componentKey: ${withComponentKey}`)

// 2) Иконки с префиксами (fi:/u:) на служебной и на рабочих
const prefixedInternal = onInternal.filter((n) => /^(fi|u):/.test(n.name))
console.log(`иконки fi:/u: на служебной: ${prefixedInternal.length} | примеры: ${prefixedInternal.slice(0, 5).map((n) => n.name).join(', ')}`)

// 3) Сеты 'button' и их варианты — везде
const buttons = []
for (const [, node] of graph.nodes) {
  if (node.type === 'COMPONENT_SET' && /^button$/i.test(node.name)) {
    const page = pageOf(node.id)
    buttons.push({ node, page })
  }
}
console.log(`\nсетов с именем "button": ${buttons.length}`)
for (const { node, page } of buttons) {
  const variants = node.childIds.map((id) => graph.getNode(id)).filter(Boolean)
  console.log(`  сет ${node.id} на странице "${page?.internalOnly ? '[служ] ' : ''}${page?.name}" | вариантов: ${variants.length} | publishId=${node.publishId ?? '-'} sourceLibraryKey=${node.sourceLibraryKey ?? '-'} componentKey=${node.componentKey ?? '-'}`)
  console.log(`    примеры вариантов: ${variants.slice(0, 5).map((v) => v.name).join(' | ')}`)
}

// 4) Из чего состоит служебный сет button: его варианты — есть ли среди них инстансы?
if (buttons.length > 0) {
  const target = buttons.find((b) => b.page?.internalOnly) ?? buttons[0]
  const variants = target.node.childIds.map((id) => graph.getNode(id)).filter(Boolean)
  for (const variant of variants.slice(0, 3)) {
    const instances = collect([variant.id], (n) => n.type === 'INSTANCE')
    console.log(`  вариант "${variant.name}": инстансов внутри ${instances.length}, примеры: ${instances.slice(0, 4).map((i) => i.name).join(', ')}`)
  }
}

// 5) Верхний уровень служебной: что за 2373 ноды (имена, типы — топ)
const topLevel = (internalPage?.childIds ?? []).map((id) => graph.getNode(id)).filter(Boolean)
const topNames = new Map()
for (const node of topLevel) topNames.set(node.type, (topNames.get(node.type) ?? 0) + 1)
console.log('\nверхний уровень служебной по типам:', [...topNames.entries()].map(([t, n]) => `${t}:${n}`).join(', '))
