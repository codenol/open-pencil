// Сводная структура дизайн-системы в один JSON: компоненты, их состав, уровни (от листьев),
// статусы прохождения. Файл служит рабочим реестром раскладки по уровням.
import { readFile, writeFile } from 'node:fs/promises'
import { BUILTIN_IO_FORMATS, IORegistry } from '/opt/open-pencil/packages/core/dist/io/index.js'

const io = new IORegistry(BUILTIN_IO_FORMATS)

const SOURCES = [
  { id: 'ds', title: 'Дизайн-система', file: '/opt/open-pencil/data/ds-unpacked/canvas.fig' },
  { id: 'icons', title: 'Иконки', file: '/opt/open-pencil/data/icons-unpacked/canvas.fig' }
]

const LEVEL_NAMES = {
  1: 'атомы',
  2: 'молекулы',
  3: 'организмы',
  4: 'блоки',
  5: 'сложные блоки',
  6: 'страницы/сборки'
}

const components = []
const sources = []
const existsBySource = new Map()

for (const source of SOURCES) {
  const bytes = new Uint8Array(await readFile(source.file))
  const { graph } = await io.readDocument({ name: 'canvas.fig', data: bytes })
  existsBySource.set(source.id, graph)

  const pageNames = new Map()
  const pageIds = new Set()
  for (const page of graph.getPages(true)) {
    pageNames.set(page.id, page)
    pageIds.add(page.id)
  }

  function pageOf(nodeId) {
    let current = graph.getNode(nodeId)
    while (current) {
      if (pageIds.has(current.id)) return pageNames.get(current.id) ?? current
      current = current.parentId ? graph.getNode(current.parentId) : undefined
    }
    return undefined
  }

  // имя сета для вариантов
  const setNameOf = new Map()
  const componentIds = []
  for (const [id, node] of graph.nodes) {
    if (node.type === 'COMPONENT_SET') {
      for (const childId of node.childIds) setNameOf.set(childId, node.name)
    }
    if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') componentIds.push(id)
  }
  const nameOf = new Map(componentIds.map((id) => [id, graph.getNode(id)?.name ?? id]))

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

  const depMap = new Map()
  for (const id of componentIds) depMap.set(id, collectInstances(id))

  // уровни: 1 + максимум по зависимостям (лист = 1)
  const level = new Map()
  const visiting = new Set()
  function computeLevel(id) {
    if (level.has(id)) return level.get(id)
    if (visiting.has(id)) return 1
    visiting.add(id)
    let max = 0
    for (const dep of depMap.get(id) ?? []) {
      if (dep === id) continue
      if (!nameOf.has(dep)) continue
      max = Math.max(max, computeLevel(dep))
    }
    visiting.delete(id)
    const value = max + 1
    level.set(id, value)
    return value
  }
  for (const id of componentIds) computeLevel(id)

  let internalCount = 0
  for (const id of componentIds) {
    const node = graph.getNode(id)
    const page = pageOf(id)
    const deps = [...(depMap.get(id) ?? [])].filter((dep) => nameOf.has(dep))
    components.push({
      id: `${source.id}:${id}`,
      source: source.id,
      name: node.name,
      type: node.type,
      setName: setNameOf.get(id) ?? null,
      page: page?.name ?? '?',
      internal: Boolean(page?.internalOnly),
      level: level.get(id),
      deps: deps.map((dep) => `${source.id}:${dep}`),
      uses: [...new Set(deps.map((dep) => setNameOf.get(dep) ?? nameOf.get(dep)))]
        .slice(0, 12)
        .map(String),
      status: 'pending'
    })
    if (page?.internalOnly) internalCount += 1
  }

  sources.push({
    id: source.id,
    title: source.title,
    file: source.file,
    components: componentIds.length,
    internalComponents: internalCount,
    pages: graph.getPages(true).length
  })
}

// порядок обхода: от листьев вверх (уровень, затем имя)
components.sort(
  (a, b) => a.level - b.level || a.source.localeCompare(b.source) || a.name.localeCompare(b.name)
)

const progress = {}
for (const component of components) {
  const key = String(component.level)
  progress[key] ??= { level: component.level, name: LEVEL_NAMES[component.level] ?? `уровень ${component.level}`, total: 0, marked: 0 }
  progress[key].total += 1
}

const payload = {
  version: 1,
  generatedAt: new Date().toISOString(),
  note: 'Реестр раскладки дизайн-системы по уровням: идём от листьев (уровень 1) вверх, отмечая компоненты в поле status.',
  levelNames: LEVEL_NAMES,
  sources,
  progress,
  components
}

const out = '/opt/open-pencil/data/ds-structure.json'
await writeFile(out, JSON.stringify(payload, null, 1))
const { size } = await import('node:fs/promises').then((fs) => fs.stat(out))
console.log(`записано: ${out}`)
console.log(`компонентов: ${components.length}, размер: ${(size / 1024 / 1024).toFixed(2)} МБ`)
for (const key of Object.keys(progress).sort((a, b) => Number(a) - Number(b))) {
  const p = progress[key]
  console.log(`уровень ${p.level} (${p.name}): ${p.total}`)
}
