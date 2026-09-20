// Анализ дизайн-системы: что из чего состоит (компоненты → вложенные компоненты → уровни)
import { readFile, writeFile } from 'node:fs/promises'
import { BUILTIN_IO_FORMATS, IORegistry } from '/opt/open-pencil/packages/core/dist/io/index.js'

const io = new IORegistry(BUILTIN_IO_FORMATS)
const bytes = new Uint8Array(await readFile('/opt/open-pencil/data/ds-unpacked/canvas.fig'))
const { graph } = await io.readDocument({ name: 'canvas.fig', data: bytes })

console.log('=== страницы ===')
for (const page of graph.getPages(true)) {
  console.log(`${page.internalOnly ? '[служ.] ' : ''}${page.name}: ${page.childIds.length} верхних нод`)
}

// Компоненты и сеты
const components = [] // {id, name, setId, pageName}
let componentSets = 0
for (const [id, node] of graph.nodes) {
  if (node.type === 'COMPONENT_SET') componentSets += 1
  if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
    const page = graph.getPages(true).find((p) => isDescendant(graph, id, p.id))
    components.push({ id, name: node.name, type: node.type, page: page?.name ?? '?', internal: page?.internalOnly })
  }
}
console.log(`\n=== компоненты: ${components.length}, сетов: ${componentSets} ===`)

function isDescendant(graph2, nodeId, ancestorId) {
  let current = graph2.getNode(nodeId)
  while (current) {
    if (current.parentId === ancestorId) return true
    current = current.parentId ? graph2.getNode(current.parentId) : undefined
  }
  return false
}

// Для каждого компонента: инстансы внутри (прямые и вложенные) → ссылки на другие компоненты
const usedBy = new Map() // componentId -> Set(componentId, на которые ссылаются инстансы внутри)
const nameOf = new Map(components.map((c) => [c.id, c.name]))

function collectInstances(rootId) {
  const seen = new Set()
  const result = new Set()
  const pending = [rootId]
  while (pending.length > 0) {
    const id = pending.pop()
    if (!id || seen.has(id)) continue
    seen.add(id)
    const node = graph.getNode(id)
    if (!node) continue
    if (node.type === 'INSTANCE' && node.componentId) result.add(node.componentId)
    pending.push(...node.childIds)
  }
  return result
}

const dependency = new Map() // componentId -> Set(componentIds)
for (const component of components) {
  dependency.set(component.id, collectInstances(component.id))
}

// Уровни: 1 = атом (ничего не использует), 2 = молекула, 3 = организм, 4+ = шаблон/сложное
const level = new Map()
function computeLevel(id, visiting = new Set()) {
  if (level.has(id)) return level.get(id)
  if (visiting.has(id)) return 1 // цикл — не углубляемся
  visiting.add(id)
  let max = 0
  for (const dep of dependency.get(id) ?? []) {
    if (dep === id) continue
    max = Math.max(max, computeLevel(dep, visiting))
  }
  const result = max + 1
  level.set(id, result)
  return result
}
for (const component of components) computeLevel(component.id)

const byLevel = new Map()
for (const component of components) {
  const l = level.get(component.id)
  if (!byLevel.has(l)) byLevel.set(l, [])
  byLevel.get(l).push(component)
}

const LEVEL_NAMES = { 1: 'атомы', 2: 'молекулы', 3: 'организмы', 4: 'сложные блоки (4)', 5: 'очень сложные (5+)' }
console.log('\n=== уровни ===')
for (const l of [...byLevel.keys()].sort()) {
  console.log(`уровень ${l} (${LEVEL_NAMES[l] ?? l}): ${byLevel.get(l).length}`)
}

// Сеты: имя варианта → имя сета (человекочитаемый состав)
const setNameOf = new Map()
for (const [id, node] of graph.nodes) {
  if (node.type === 'COMPONENT_SET') {
    for (const childId of node.childIds) setNameOf.set(childId, node.name)
  }
}
function displayName(id) {
  return setNameOf.get(id) ?? nameOf.get(id) ?? id
}

console.log('\n=== примеры «из чего состоит» (только контентные страницы) ===')
const content = components.filter((c) => !c.internal)
for (const l of [...byLevel.keys()].sort()) {
  const sample = content.filter((c) => level.get(c.id) === l).slice(0, 5)
  if (sample.length === 0) continue
  console.log(`\n-- уровень ${l} --`)
  for (const component of sample) {
    const deps = [...new Set([...(dependency.get(component.id) ?? [])].map(displayName))].slice(0, 8)
    console.log(`${component.name} [${component.page}] ← ${deps.length ? deps.join(' | ') : '(лист)'}`)
  }
}

// Следы внешних библиотек: publishId / sourceLibraryKey / componentKey
console.log('\n=== внешние библиотеки в файле ===')
let withPublishId = 0
let withSourceKey = 0
let withComponentKey = 0
for (const [, node] of graph.nodes) {
  if (node.publishId) withPublishId += 1
  if (node.sourceLibraryKey) withSourceKey += 1
  if (node.componentKey) withComponentKey += 1
}
console.log('нод с publishId:', withPublishId, '| sourceLibraryKey:', withSourceKey, '| componentKey:', withComponentKey)

// Размер служебной страницы: сколько компонентов там — внутренние копии
console.log('\n=== внутренние копии (Internal Only Canvas) ===')
const internalComponents = components.filter((c) => c.internal)
console.log('компонентов на служебной странице:', internalComponents.length)
console.log('примеры:', internalComponents.slice(0, 10).map((c) => c.name).join(', '))

// Статистика по страницам: где что лежит
console.log('\n=== по страницам ===')
const pages = new Map()
for (const component of components) {
  if (!pages.has(component.page)) pages.set(component.page, [])
  pages.get(component.page).push(component)
}
for (const [page, list] of pages) {
  const levels = list.map((c) => level.get(c.id))
  console.log(`${page}: ${list.length} компонентов, уровни ${Math.min(...levels)}–${Math.max(...levels)}`)
}
