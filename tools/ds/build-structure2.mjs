// Реестр v2: сущности (сеты + одиночные компоненты), свойства вариантов как в токенах,
// сопоставление с группами токенов, внешние ссылки на библиотеки-источники.
import { readFile, writeFile } from 'node:fs/promises'
import { BUILTIN_IO_FORMATS, IORegistry } from '/opt/open-pencil/packages/core/dist/io/index.js'

const io = new IORegistry(BUILTIN_IO_FORMATS)
const { graph } = await io.readDocument({
  name: 'canvas.fig',
  data: new Uint8Array(await readFile('/opt/open-pencil/data/ds-unpacked/canvas.fig'))
})

const pages = graph.getPages(true)
const pageIds = new Set(pages.map((p) => p.id))
function pageOf(nodeId) {
  let current = graph.getNode(nodeId)
  while (current) {
    if (pageIds.has(current.id)) return current
    current = current.parentId ? graph.getNode(current.parentId) : undefined
  }
  return undefined
}

// --- токены: группы и оси ---
const tokens = JSON.parse(await readFile('/root/.hermes/cache/documents/doc_5b952e51eaf4_Light.tokens.json', 'utf8'))
function collectPaths(object, path = '', out = []) {
  for (const [key, value] of Object.entries(object)) {
    if (key === '$extensions') continue
    const next = path ? `${path}.${key}` : key
    if (value && typeof value === 'object' && '$value' in value) out.push(next)
    else if (value && typeof value === 'object') collectPaths(value, next, out)
  }
  return out
}
const tokenPaths = collectPaths(tokens)
const tokenGroups = new Map()
for (const path of tokenPaths) {
  const parts = path.split('.')
  const group = parts[0]
  if (!tokenGroups.has(group)) tokenGroups.set(group, [])
  tokenGroups.get(group).push(parts.slice(1))
}
function axesOf(group) {
  const axes = []
  for (const segments of tokenGroups.get(group) ?? []) {
    segments.forEach((value, index) => {
      axes[index] ??= new Set()
      axes[index].add(value)
    })
  }
  return axes.map((set) => [...set].sort())
}

const normalize = (name) => name.trim().toLowerCase().replace(/\s+/g, '-')
function tokenGroupFor(name) {
  const key = normalize(name)
  if (tokenGroups.has(key)) return key
  // частичные совпадения (input datepicker → input-datepicker; Button → button)
  for (const group of tokenGroups.keys()) {
    if (key.startsWith(group) || group.startsWith(key)) return group
  }
  return null
}

// --- сущности ---
const entityByNode = new Map() // id варианта/компонента → id сущности
const entities = []

function propertyAxesOf(setNode) {
  const axes = new Map()
  const variants = setNode.childIds.map((id) => graph.getNode(id)).filter(Boolean)
  for (const variant of variants) {
    for (const part of variant.name.split(',')) {
      const [key, value] = part.split('=').map((s) => s.trim())
      if (!key || !value) continue
      if (!axes.has(key)) axes.set(key, new Set())
      axes.get(key).add(value)
    }
  }
  return Object.fromEntries([...axes.entries()].map(([key, values]) => [key, [...values].sort()]))
}

function collectDeps(rootIds) {
  const seen = new Set()
  const result = new Set()
  const pending = [...rootIds]
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

// сеты
for (const [, node] of graph.nodes) {
  if (node.type !== 'COMPONENT_SET') continue
  const page = pageOf(node.id)
  const variantIds = node.childIds.filter((id) => graph.getNode(id)?.type === 'COMPONENT')
  for (const variantId of variantIds) entityByNode.set(variantId, node.id)
  const group = tokenGroupFor(node.name)
  entities.push({
    id: `ds:${node.id}`,
    nodeId: node.id,
    source: 'ds',
    kind: 'set',
    name: node.name.trim(),
    page: page?.name ?? '?',
    internal: Boolean(page?.internalOnly),
    variants: variantIds.length,
    properties: propertyAxesOf(node),
    deps: [], // заполним ниже
    uses: [],
    external: node.sourceLibraryKey
      ? { libraryKey: node.sourceLibraryKey, componentKey: node.componentKey ?? null, publishId: node.publishId ?? null }
      : null,
    tokenGroup: group,
    tokenAxes: group ? axesOf(group) : null,
    level: 0,
    status: 'pending'
  })
}
// одиночные
for (const [, node] of graph.nodes) {
  if (node.type !== 'COMPONENT') continue
  const parent = node.parentId ? graph.getNode(node.parentId) : undefined
  if (parent?.type === 'COMPONENT_SET') continue
  const page = pageOf(node.id)
  entityByNode.set(node.id, node.id)
  const group = tokenGroupFor(node.name)
  entities.push({
    id: `ds:${node.id}`,
    nodeId: node.id,
    source: 'ds',
    kind: 'component',
    name: node.name.trim(),
    page: page?.name ?? '?',
    internal: Boolean(page?.internalOnly),
    variants: 0,
    properties: null,
    deps: [],
    uses: [],
    external: node.sourceLibraryKey
      ? { libraryKey: node.sourceLibraryKey, componentKey: node.componentKey ?? null, publishId: node.publishId ?? null }
      : null,
    tokenGroup: group,
    tokenAxes: group ? axesOf(group) : null,
    level: 0,
    status: 'pending'
  })
}
const entityById = new Map(entities.map((entity) => [entity.id, entity]))
const nameOf = new Map(entities.map((entity) => [entity.id, entity.name]))

// зависимости: для сета — по всем вариантам; сущности целей
for (const entity of entities) {
  const roots = entity.kind === 'set' ? graph.getNode(entity.nodeId)?.childIds ?? [] : [entity.nodeId]
  const deps = new Set()
  for (const rootId of roots) {
    for (const componentNodeId of collectDeps([rootId])) {
      const targetEntityId = entityByNode.get(componentNodeId)
      if (targetEntityId === entity.id) continue
      if (targetEntityId) deps.add(`ds:${targetEntityId}`)
    }
  }
  entity.deps = [...deps]
  entity.uses = [...new Set(entity.deps.map((id) => nameOf.get(id) ?? id))].slice(0, 12)
}

// уровни от листьев
const levelOf = new Map()
const visiting = new Set()
function computeLevel(id) {
  if (levelOf.has(id)) return levelOf.get(id)
  if (visiting.has(id)) return 1
  visiting.add(id)
  const entity = entityById.get(id)
  let max = 0
  for (const depId of entity?.deps ?? []) max = Math.max(max, computeLevel(depId))
  visiting.delete(id)
  const value = max + 1
  levelOf.set(id, value)
  return value
}
for (const entity of entities) entity.level = computeLevel(entity.id)

entities.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))

const progress = {}
for (const entity of entities) {
  const key = String(entity.level)
  progress[key] ??= { level: entity.level, total: 0, marked: 0 }
  progress[key].total += 1
}

const LEVEL_NAMES = {
  1: 'атомы',
  2: 'молекулы',
  3: 'организмы',
  4: 'блоки',
  5: 'сложные блоки',
  6: 'страницы/сборки'
}
const payload = {
  version: 2,
  generatedAt: new Date().toISOString(),
  levelNames: LEVEL_NAMES,
  note: 'Реестр сущностей дизайн-системы: сеты и одиночные компоненты (варианты — свойство сущности, а не отдельная запись). Ориентир структуры — токены. Идём от листьев вверх, отмечая status.',
  tokenSource: { groups: tokenGroups.size, paths: tokenPaths.length },
  progress,
  entities
}
await writeFile('/opt/open-pencil/data/ds-structure.json', JSON.stringify(payload, null, 1))

console.log(`сущностей: ${entities.length} (сетов ${entities.filter((e) => e.kind === 'set').length}, одиночных ${entities.filter((e) => e.kind === 'component').length})`)
console.log(`из них со ссылкой на внешнюю библиотеку: ${entities.filter((e) => e.external).length}`)
console.log(`сопоставлено с группами токенов: ${entities.filter((e) => e.tokenGroup).length}`)
console.log('уровни:')
for (const key of Object.keys(progress).sort((a, b) => Number(a) - Number(b))) {
  console.log(`  уровень ${key}: ${progress[key].total}`)
}
console.log('примеры с токенами:')
for (const entity of entities.filter((e) => e.tokenGroup).slice(0, 8)) {
  console.log(`  ${entity.name.slice(0, 28).padEnd(28)} → токены "${entity.tokenGroup}" | свойств: ${entity.properties ? Object.keys(entity.properties).join(', ') : '-'}`)
}
