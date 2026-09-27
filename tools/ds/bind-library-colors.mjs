// Привязка цветов библиотеки к токенам темы.
//
// Прежняя привязка закрыла фоны и обводки части компонентов: тексты, иконки,
// статусы, сайдбар и табы остались литералами. Значение у них при этом
// совпадает с токеном — не хватало самой привязки.
//
// Идём по всем мастерам, для каждой сплошной заливки и обводки ищем токен
// с тем же значением в светлом режиме: сначала по роли (текст, иконка, фон,
// обводка, статус), потом по одному значению. Значение, у которого токена нет,
// оставляем как есть и показываем в отчёте.
//
// Запуск: bun tools/ds/bind-library-colors.mjs <вход.fig> <выход.fig> [--check]
import { readFile, writeFile } from 'node:fs/promises'

import * as corePkg from '@open-pencil/core'
import { exportFigFile } from '@open-pencil/core/io'
import { releaseFigPopulationWorker } from '@open-pencil/core/kiwi'
import * as figPkg from '@open-pencil/fig'

const argv = process.argv.slice(2)
const positional = argv.filter((arg) => !arg.startsWith('--'))
const checkOnly = argv.includes('--check')
const [input, output] = positional
if (!input) {
  console.error('нужно: bun tools/ds/bind-library-colors.mjs <вход.fig> <выход.fig> [--check]')
  process.exit(1)
}

const bytes = new Uint8Array(await readFile(input))
const parsed = figPkg.parseFigBuffer(bytes.buffer)
const graph = corePkg.importNodeChanges(parsed.nodeChanges, parsed.blobs, new Map(parsed.images), {
  populate: 'none'
})

const hex = (color) =>
  '#' + [color.r, color.g, color.b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')

// ── Токены темы: путь → цвет в светлом режиме ──────────────────────────────

const theme = [...graph.variableCollections.values()].find((collection) =>
  collection.modes.some((mode) => mode.name.toLowerCase() === 'light')
)
if (!theme) throw new Error('в документе нет коллекции с режимом Light')
const lightMode = theme.modes.find((mode) => mode.name.toLowerCase() === 'light').modeId

function colorOf(variable, depth = 0) {
  if (depth > 8) return null
  const value = variable.valuesByMode[lightMode] ?? Object.values(variable.valuesByMode)[0]
  if (!value) return null
  if (typeof value === 'object' && 'aliasId' in value) {
    const target = graph.variables.get(value.aliasId)
    return target ? colorOf(target, depth + 1) : null
  }
  return typeof value === 'object' && 'r' in value ? value : null
}

const tokens = []
for (const id of theme.variableIds) {
  const variable = graph.variables.get(id)
  if (!variable || variable.type !== 'COLOR') continue
  const color = colorOf(variable)
  if (color) tokens.push({ id: variable.id, name: variable.name, color, value: hex(color) })
}

const byValue = new Map()
for (const token of tokens) {
  const list = byValue.get(token.value) ?? []
  list.push(token)
  byValue.set(token.value, list)
}

// ── Роли ──────────────────────────────────────────────────────────────────

const ROLES_BY_TYPE = {
  TEXT: ['text'],
  INSTANCE: ['icon', 'background', 'thumb', 'track', 'border'],
  FRAME: ['background', 'icon'],
  ROUNDED_RECTANGLE: ['background', 'thumb', 'track', 'border'],
  VECTOR: ['icon', 'background'],
  BOOLEAN_OPERATION: ['icon', 'background'],
  ELLIPSE: ['background', 'icon'],
  LINE: ['border'],
  GROUP: ['background']
}

const ROLE_WORDS = ['text', 'icon', 'background', 'border', 'stroke', 'thumb', 'track', 'status']

/** Роль токена: слово из пути, если оно есть в словаре ролей. */
function roleOf(token) {
  for (const segment of token.name.split('/')) if (ROLE_WORDS.includes(segment)) return segment
  return null
}

/** Токен под цвет и роли узла: сначала по роли, потом по одному значению. */
function findToken(value, roles, namespace) {
  const candidates = byValue.get(value) ?? []
  if (candidates.length === 0) return null
  const byRole = candidates.filter((token) => {
    const role = roleOf(token)
    return role !== null && roles.includes(role)
  })
  const pool = byRole.length > 0 ? byRole : candidates
  if (pool.length === 1) return pool[0]
  // Ближе тот токен, чей путь начинается с имени компонента.
  const scored = pool
    .map((token) => ({
      token,
      score:
        (namespace && token.name.toLowerCase().startsWith(`${namespace}/`) ? 2 : 0) +
        (roleOf(token) && roles.includes(roleOf(token)) ? 1 : 0) -
        token.name.split('/').length * 0.01
    }))
    .sort((a, b) => b.score - a.score)
  return scored[0].token
}

function namespaceOf(node) {
  let current = node
  while (current) {
    const parent = current.parentId ? graph.getNode(current.parentId) : null
    if (parent?.type === 'COMPONENT_SET') return parent.name.trim().toLowerCase()
    current = parent
  }
  return null
}

// ── Обход мастеров ────────────────────────────────────────────────────────

const report = { bound: 0, kept: [], perComponent: new Map() }
const statsOf = (namespace) => {
  const key = namespace ?? '—'
  const stats = report.perComponent.get(key) ?? { bound: 0, kept: 0 }
  report.perComponent.set(key, stats)
  return stats
}

function bindNode(node, namespace) {
  const roles = ROLES_BY_TYPE[node.type] ?? ['background']
  for (const [prop, list] of [
    ['fills', node.fills ?? []],
    ['strokes', node.strokes ?? []]
  ]) {
    list.forEach((paint, index) => {
      if (paint.type !== 'SOLID' || !paint.color) return
      const value = hex(paint.color)
      const token = findToken(value, roles, namespace)
      const stats = statsOf(namespace)
      if (!token) {
        stats.kept += 1
        if (report.kept.length < 25) report.kept.push(`${node.name.trim().slice(0, 30)} ${prop} ${value}`)
        return
      }
      if (!checkOnly) graph.bindVariable(node.id, `${prop}/${index}/color`, token.id)
      stats.bound += 1
      report.bound += 1
    })
  }
  for (const child of graph.getChildren(node.id) ?? []) bindNode(child, namespace)
}

/** Кадры экранов: их собственные узлы тоже красим токенами, но внутрь копий не лезем. */
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
  bindNode(master, namespaceOf(master))
}

for (const frame of pageFrames) bindScreen(frame, frame.name.trim().toLowerCase())

const allTokens = tokens.length
console.log(`токенов темы: ${allTokens}`)
console.log(`привязок ${checkOnly ? 'будет создано' : 'создано'}: ${report.bound}`)
console.log(`литералов без подходящего токена: ${[...report.perComponent.values()].reduce((sum, s) => sum + s.kept, 0)}`)
if (report.kept.length > 0) {
  console.log('\nбез токена (первые 25):')
  for (const line of report.kept) console.log('  ' + line)
}
console.log('\nпо компонентам (привязано / без токена):')
for (const [namespace, stats] of [...report.perComponent].sort((a, b) => b[1].bound - a[1].bound).slice(0, 24)) {
  console.log(`  ${namespace.padEnd(22)} ${String(stats.bound).padStart(5)} / ${String(stats.kept).padStart(4)}`)
}

if (checkOnly || !output) process.exit(0)

releaseFigPopulationWorker(graph)
const exported = await exportFigFile(graph, undefined, undefined, undefined, false, {
  noImplicitInternalCanvas: true
})
await writeFile(
  output,
  Buffer.from(exported.buffer.slice(exported.byteOffset, exported.byteOffset + exported.byteLength))
)
console.log(`\nзаписано: ${output} (${Math.round(exported.byteLength / 1024)} КБ)`)
