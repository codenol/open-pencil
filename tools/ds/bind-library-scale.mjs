// Привязка отступов, зазоров и радиусов к ступеням коллекции «Шкала».
//
// Цвета в документе уже на токенах, а геометрия — нет: padding, itemSpacing и
// cornerRadius заданы числами. Из-за этого правило «отступы по шкале» нельзя ни
// проверить, ни соблюсти: непонятно, 16 — это ступень или случайное число.
//
// Проход привязывает только точные совпадения со ступенью: значение узла равно
// значению переменной, поэтому картинка не меняется, меняется только запись.
// Числа, которых в шкале нет, остаются как есть и попадают в отчёт — по ним
// видно, каких ступеней не хватает.
//
// Запуск:
//   bun tools/ds/bind-library-scale.mjs <вход.fig> --report        — только отчёт
//   bun tools/ds/bind-library-scale.mjs <вход.fig> --check         — сколько привяжется
//   bun tools/ds/bind-library-scale.mjs <вход.fig> <выход.fig>     — применить
import { readFile, writeFile } from 'node:fs/promises'

import * as corePkg from '@open-pencil/core'
import { exportFigFile } from '@open-pencil/core/io'
import { releaseFigPopulationWorker } from '@open-pencil/core/kiwi'
import * as figPkg from '@open-pencil/fig'

const argv = process.argv.slice(2)
const positional = argv.filter((arg) => !arg.startsWith('--'))
const checkOnly = argv.includes('--check')
const reportOnly = argv.includes('--report')
const [input, output] = positional
if (!input) {
  console.error('нужно: bun tools/ds/bind-library-scale.mjs <вход.fig> [<выход.fig>] [--check|--report]')
  process.exit(1)
}

// Отступы и зазоры — ступени space/N, радиусы — radius/N.
const SPACE_FIELDS = [
  'paddingLeft',
  'paddingRight',
  'paddingTop',
  'paddingBottom',
  'itemSpacing',
  'counterAxisSpacing',
  'gridRowGap',
  'gridColumnGap'
]
const RADIUS_FIELDS = [
  'cornerRadius',
  'topLeftRadius',
  'topRightRadius',
  'bottomLeftRadius',
  'bottomRightRadius'
]

const bytes = new Uint8Array(await readFile(input))
const parsed = figPkg.parseFigBuffer(bytes.buffer, { skipThumbnail: true })
const graph = corePkg.importNodeChanges(parsed.nodeChanges, parsed.blobs, new Map(parsed.images), {
  populate: 'none'
})

// ── Шкала ─────────────────────────────────────────────────────────────────

const collection = [...graph.variableCollections.values()].find(
  (item) => item.name.trim() === 'Шкала'
)
if (!collection) throw new Error('в документе нет коллекции «Шкала»')
const modeId = collection.modes[0]?.modeId

const spaceByValue = new Map()
const radiusByValue = new Map()
for (const id of collection.variableIds) {
  const variable = graph.variables.get(id)
  if (!variable || variable.type !== 'FLOAT') continue
  const value = variable.valuesByMode[modeId] ?? Object.values(variable.valuesByMode)[0]
  if (typeof value !== 'number') continue
  const target = variable.name.startsWith('radius/') ? radiusByValue : spaceByValue
  target.set(value, variable)
}
const stepsOf = (map) => [...map.keys()].sort((a, b) => a - b).join(', ')

// ── Обход ─────────────────────────────────────────────────────────────────

const report = {
  bound: 0,
  already: 0,
  offScale: new Map(), // `${family} ${value}` → счётчик
  perNamespace: new Map()
}
const statsOf = (namespace) => {
  const key = namespace ?? '—'
  const stats = report.perNamespace.get(key) ?? { bound: 0, already: 0, off: 0 }
  report.perNamespace.set(key, stats)
  return stats
}
const noteOffScale = (family, value, node) => {
  const key = `${family} ${value}`
  const entry = report.offScale.get(key) ?? { count: 0, sample: node.name.trim().slice(0, 28) }
  entry.count += 1
  report.offScale.set(key, entry)
}

function bindNode(node, namespace) {
  const stats = statsOf(namespace)
  for (const [fields, table, family] of [
    [SPACE_FIELDS, spaceByValue, 'space'],
    [RADIUS_FIELDS, radiusByValue, 'radius']
  ]) {
    for (const field of fields) {
      const value = node[field]
      if (typeof value !== 'number' || value === 0) continue
      const variable = table.get(value)
      if (!variable) {
        stats.off += 1
        noteOffScale(family, value, node)
        continue
      }
      const current = node.boundVariables[field]
      if (current === variable.id) {
        stats.already += 1
        report.already += 1
        continue
      }
      if (!reportOnly && !checkOnly) graph.bindVariable(node.id, field, variable.id)
      stats.bound += 1
      report.bound += 1
    }
  }
  for (const child of graph.getChildren(node.id) ?? []) bindNode(child, namespace)
}

/** Кадры экранов: их собственные узлы тоже на шкале, но внутрь копий не лезем. */
function bindScreen(node, namespace) {
  if (node.type === 'INSTANCE') return
  bindNode(node, namespace)
}

const pageFrames = []
for (const page of graph.getPages(true)) {
  for (const child of graph.getChildren(page.id) ?? []) {
    if (child.type === 'FRAME' || child.type === 'GROUP' || child.type === 'SECTION') {
      pageFrames.push(child)
    }
  }
}

const masters = [...graph.nodes.values()].filter(
    (node) => node.type === 'COMPONENT' || node.type === 'COMPONENT_SET'
)
for (const master of masters) {
  if (master.type === 'COMPONENT_SET') {
    for (const variant of graph.getChildren(master.id) ?? []) {
      bindNode(variant, master.name.trim().toLowerCase())
    }
    continue
  }
  const parent = master.parentId ? graph.getNode(master.parentId) : null
  if (parent?.type === 'COMPONENT_SET') continue
  bindNode(master, master.name.trim().toLowerCase())
}

for (const frame of pageFrames) bindScreen(frame, frame.name.trim().toLowerCase())

// ── Отчёт ─────────────────────────────────────────────────────────────────

const offTotal = [...report.offScale.values()].reduce((sum, item) => sum + item.count, 0)
console.log(`шкала: space/ ${stepsOf(spaceByValue)}`)
console.log(`шкала: radius/ ${stepsOf(radiusByValue)}`)
const verb = reportOnly ? 'нужно' : (checkOnly ? 'будет создано' : 'создано')
console.log(`привязок ${verb}: ${report.bound}`)
console.log(`уже на шкале: ${report.already}`)
console.log(`чисел не со шкалы: ${offTotal}`)

const offenders = [...report.offScale]
  .map(([key, item]) => ({ key, ...item }))
  .sort((a, b) => b.count - a.count)
if (offenders.length > 0) {
  console.log('\nне со шкалы (топ 25):')
  for (const item of offenders.slice(0, 25)) {
    console.log(`  ${item.key.padEnd(14)} ${String(item.count).padStart(5)}   напр. ${item.sample}`)
  }
}

console.log('\nпо компонентам (привязано / уже / мимо):')
for (const [namespace, stats] of [...report.perNamespace]
  .sort((a, b) => b[1].bound + b[1].already - (a[1].bound + a[1].already))
  .slice(0, 24)) {
  console.log(
    `  ${namespace.padEnd(22)} ${String(stats.bound).padStart(5)} / ${String(stats.already).padStart(4)} / ${String(stats.off).padStart(4)}`
  )
}

if (reportOnly || checkOnly || !output) process.exit(0)

releaseFigPopulationWorker(graph)
const exported = await exportFigFile(graph, undefined, undefined, undefined, false, {
  noImplicitInternalCanvas: true
})
await writeFile(
  output,
  Buffer.from(exported.buffer.slice(exported.byteOffset, exported.byteOffset + exported.byteLength))
)
console.log(`\nзаписано: ${output} (${Math.round(exported.byteLength / 1024)} КБ)`)
