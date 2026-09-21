// Строит граф связей компонентов дизайн-системы для визуализации.
//
// Узлы — компоненты и сеты, рёбра — ссылки инстанс → мастер.
// Ребро помечается цветом: есть связь (ok) или должна быть, но потеряна (broken).
//
// Запуск: bun tools/ds/build-graph-json.mjs <canvas.fig> <выход.json>
import { readFile, writeFile } from 'node:fs/promises'

import * as figPkg from '/opt/open-pencil-clean/packages/fig/dist/index.js'
import * as corePkg from '/opt/open-pencil-clean/packages/core/dist/index.js'

const [input, output] = process.argv.slice(2)
if (!input || !output) {
  console.error('нужно: bun tools/ds/build-graph-json.mjs <canvas.fig> <выход.json>')
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

const units = [...graph.nodes.values()].filter(
  (node) => node.type === 'COMPONENT' || node.type === 'COMPONENT_SET'
)
const unitIds = new Set(units.map((u) => u.id))

// Мастера по имени — чтобы понять, есть ли потерянной связи куда указывать.
const mastersByName = new Map()
for (const unit of units) {
  const name = unit.name.trim()
  if (!mastersByName.has(name)) mastersByName.set(name, [])
  mastersByName.get(name).push(unit)
}

const nodes = new Map()
for (const unit of units) {
  nodes.set(unit.id, {
    id: unit.id,
    name: unit.name.trim(),
    type: unit.type,
    pageId: pageOf(unit.id),
    variantCount: unit.type === 'COMPONENT_SET' ? unit.childIds.length : 0,
    nodeCount: 0,
    uses: 0,
    usedBy: 0,
    broken: 0,
    brokenFixable: 0,
    text: ''
  })
}

const edges = []
const edgeSeen = new Set()

for (const unit of units) {
  const walk = (id, depth) => {
    const node = graph.getNode(id)
    if (!node) return
    const self = nodes.get(unit.id)
    if (self) self.nodeCount += 1
    if (node.type === 'TEXT' && !self?.text && (node.text ?? '').length > 0) {
      self.text = node.text.slice(0, 24)
    }
    if (node.type === 'INSTANCE') {
      if (node.componentId && unitIds.has(node.componentId) && node.componentId !== unit.id) {
        // Живая связь между двумя единицами.
        const key = `${unit.id}>${node.componentId}`
        if (!edgeSeen.has(key)) {
          edgeSeen.add(key)
          edges.push({ from: unit.id, to: node.componentId, kind: 'ok' })
          const a = nodes.get(unit.id)
          const b = nodes.get(node.componentId)
          if (a) a.uses += 1
          if (b) b.usedBy += 1
        }
      } else if (!node.componentId) {
        // Потерянная связь: ищем мастера по имени.
        const candidates = (mastersByName.get(node.name.trim()) ?? []).filter(
          (c) => c.id !== node.id
        )
        const fixable = candidates.find((c) => c.childIds.length > 0) ?? null
        const self2 = nodes.get(unit.id)
        if (self2) {
          self2.broken += 1
          if (fixable) self2.brokenFixable += 1
        }
        const targetId = fixable?.id ?? null
        if (targetId && targetId !== unit.id) {
          const key = `${unit.id}~>${targetId}`
          if (!edgeSeen.has(key)) {
            edgeSeen.add(key)
            edges.push({ from: unit.id, to: targetId, kind: 'broken' })
          }
        }
      }
    }
    for (const childId of node.childIds) walk(childId, depth + 1)
  }
  for (const childId of unit.childIds) walk(childId, 0)
}

const pages = graph.getPages(true).map((page) => ({
  id: page.id,
  name: page.name,
  internal: page.internalOnly === true
}))

const list = [...nodes.values()]
const summary = {
  pages: pages.length,
  units: list.length,
  edges: edges.length,
  ok: edges.filter((e) => e.kind === 'ok').length,
  broken: edges.filter((e) => e.kind === 'broken').length,
  orphans: list.filter((n) => n.uses === 0 && n.usedBy === 0 && n.broken === 0).length,
  brokenTotal: list.reduce((s, n) => s + n.broken, 0),
  brokenFixable: list.reduce((s, n) => s + n.brokenFixable, 0)
}

await writeFile(output, JSON.stringify({ summary, pages, nodes: list, edges }))
console.log(`узлов: ${summary.units} | рёбер: ${summary.edges} (ок ${summary.ok}, разорвано ${summary.broken})`)
console.log(`без связей вообще: ${summary.orphans}`)
console.log(`разорванных ссылок внутри: ${summary.brokenTotal} (чинится ${summary.brokenFixable})`)
console.log(`записано: ${output}`)
