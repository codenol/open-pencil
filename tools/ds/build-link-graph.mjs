// Строит карту связей дизайн-системы: страницы, компоненты, их состав
// и связи «инстанс → мастер». Отдаёт JSON для страницы на сайте.
//
// Запуск: bun tools/ds/build-link-graph.mjs <canvas.fig> <выход.json>
import { readFile, writeFile } from 'node:fs/promises'

import * as figPkg from '/opt/open-pencil-clean/packages/fig/dist/index.js'
import * as corePkg from '/opt/open-pencil-clean/packages/core/dist/index.js'

const [input, output] = process.argv.slice(2)
if (!input || !output) {
  console.error('нужно: bun tools/ds/build-link-graph.mjs <canvas.fig> <выход.json>')
  process.exit(1)
}

const bytes = new Uint8Array(await readFile(input))
const parsed = figPkg.parseFigBuffer(bytes.buffer)
const graph = corePkg.importNodeChanges(parsed.nodeChanges, parsed.blobs, new Map(parsed.images), {
  populate: 'none'
})

const pageOf = (nodeId) => {
  let node = graph.getNode(nodeId)
  while (node && node.type !== 'CANVAS') node = graph.getNode(node.parentId)
  return node?.id ?? null
}

/** Все потомки ноды (без самой ноды). */
function descendants(nodeId) {
  const out = []
  const walk = (id, depth) => {
    const node = graph.getNode(id)
    if (!node) return
    out.push({ node, depth })
    for (const childId of node.childIds) walk(childId, depth + 1)
  }
  for (const childId of graph.getNode(nodeId)?.childIds ?? []) walk(childId, 1)
  return out
}

// Компоненты и сеты — «единицы» системы.
const units = [...graph.nodes.values()].filter(
  (node) => node.type === 'COMPONENT' || node.type === 'COMPONENT_SET'
)

// Индексы: имя → мастера; id → узел.
const mastersByName = new Map()
for (const unit of units) {
  const name = unit.name.trim()
  if (!mastersByName.has(name)) mastersByName.set(name, [])
  mastersByName.get(name).push(unit)
}

const unitsOut = []
for (const unit of units) {
  const kids = descendants(unit.id)

  // Состав: типы детей и вложенные инстансы.
  const types = new Map()
  for (const { node } of kids) types.set(node.type, (types.get(node.type) ?? 0) + 1)

  const uses = [] // «на что ссылается этот компонент»
  const broken = [] // инстансы внутри без ссылки на мастер
  const seen = new Set()
  for (const { node } of kids) {
    if (node.type !== 'INSTANCE') continue
    if (node.componentId) {
      const master = graph.getNode(node.componentId)
      const key = `${node.name.trim()}|${node.componentId}`
      if (master && !seen.has(key)) {
        seen.add(key)
        uses.push({
          name: node.name.trim(),
          count: kids.filter((k) => k.node.type === 'INSTANCE' && k.node.componentId === node.componentId).length,
          masterId: master.id,
          masterName: master.name.trim(),
          masterType: master.type,
          pageId: pageOf(master.id)
        })
      }
    } else {
      const key = node.name.trim()
      const entry = broken.find((b) => b.name === key)
      if (entry) entry.count += 1
      else {
        const candidates = mastersByName.get(key) ?? []
        broken.push({
          name: key,
          count: 1,
          // Есть ли в файле мастер с таким именем — тогда связь просто потеряна.
          hasMaster: candidates.some((c) => c.id !== node.id && c.childIds.length > 0),
          masterId: candidates.find((c) => c.id !== node.id && c.childIds.length > 0)?.id ?? null
        })
      }
    }
  }

  unitsOut.push({
    id: unit.id,
    name: unit.name.trim(),
    type: unit.type,
    pageId: pageOf(unit.id),
    variantCount: unit.type === 'COMPONENT_SET' ? unit.childIds.length : 0,
    nodeCount: kids.length + 1,
    types: Object.fromEntries([...types.entries()].sort((a, b) => b[1] - a[1])),
    textSamples: kids
      .filter((k) => k.node.type === 'TEXT' && (k.node.text ?? '').length > 0)
      .slice(0, 3)
      .map((k) => k.node.text.slice(0, 24)),
    uses,
    broken
  })
}

const pages = graph.getPages(true).map((page) => ({
  id: page.id,
  name: page.name,
  internal: page.internalOnly === true
}))

const summary = {
  pages: pages.length,
  units: unitsOut.length,
  instances: graph.nodes.size,
  linked: unitsOut.reduce((sum, u) => sum + u.uses.reduce((s, x) => s + x.count, 0), 0),
  broken: unitsOut.reduce((sum, u) => sum + u.broken.reduce((s, x) => s + x.count, 0), 0),
  brokenWithMaster: unitsOut.reduce(
    (sum, u) => sum + u.broken.filter((b) => b.hasMaster).reduce((s, x) => s + x.count, 0),
    0
  )
}

await writeFile(output, JSON.stringify({ summary, pages, units: unitsOut }))
console.log(`единиц: ${summary.units} | страниц: ${summary.pages}`)
console.log(`связей: ${summary.linked} | разорвано: ${summary.broken} (из них починить можно ${summary.brokenWithMaster})`)
console.log(`записано: ${output}`)
