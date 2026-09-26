// Привязка переменных темы к мастерам дизайн-системы.
//
// Имя токена — это путь из размерностей: `button/filled/accent/background/
// default` — тип, настроение, роль и состояние. У варианта мастера те же
// размерности лежат в имени (`State=Default, Type=Filled, Sentiment=Accent`),
// а роль задаёт свойство узла: заливка — `background`, обводка — `border`,
// текст внутри — `text`, вложенная иконка — `icon`.
//
// Токен ищем **по цвету**: цвет светлой темы у мастера должен точно совпасть
// со значением токена. Тогда привязка ничего не меняет на экране, а имя лишь
// уточняет размерность. Если под один цвет и роль подходит несколько токенов
// с равным весом — не гадаем, а пишем в отчёт.
//
// Запуск:
//   bun tools/ds/bind-tokens.mjs <вход.fig> [выход.fig] \
//     --dark=Dark.tokens.json --light=Light.tokens.json [--limit=5]
//
// Без выходного файла — только отчёт, документ не меняется.
// Проверка записанного файла:
//   bun tools/ds/bind-tokens.mjs --verify=<файл.fig> --dark=… --light=…
import { readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'

import * as corePkg from '@open-pencil/core'
import { exportFigFile } from '@open-pencil/core/io'
import { releaseFigPopulationWorker } from '@open-pencil/core/kiwi'
import * as figPkg from '@open-pencil/fig'

const argv = process.argv.slice(2)
const positional = argv.filter((arg) => !arg.startsWith('--'))
const flag = (name, fallback = undefined) => {
  const found = argv.find((arg) => arg.startsWith(`--${name}=`))
  return found ? found.slice(name.length + 3) : fallback
}

const darkPath = flag('dark')
const lightPath = flag('light')
const verifyPath = flag('verify')
const limit = Number(flag('limit', '6'))
if (!darkPath || !lightPath) {
  console.error('нужны --dark=<файл> и --light=<файл>')
  process.exit(1)
}

function flatten(node, path, out) {
  if (node === null || typeof node !== 'object') return
  if (Object.hasOwn(node, '$value')) {
    out.set(path, node)
    return
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === '$extensions') continue
    flatten(value, path ? `${path}/${key}` : key, out)
  }
}

function colorOf(token) {
  const value = token?.$value ?? {}
  const [r = 0, g = 0, b = 0] = value.components ?? []
  return { r, g, b, a: typeof value.alpha === 'number' ? value.alpha : 1 }
}

function colorKey(color) {
  const part = (value) => Math.round((value ?? 0) * 1000)
  return `${part(color.r)}:${part(color.g)}:${part(color.b)}:${part(color.a ?? 1)}`
}

function hex(color) {
  if (!color) return '—'
  const to = (value) =>
    Math.round(Math.max(0, Math.min(1, value ?? 0)) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${to(color.r)}${to(color.g)}${to(color.b)}`
}

const lightTokens = new Map()
flatten(JSON.parse(readFileSync(lightPath, 'utf8')), '', lightTokens)
// Тёмная тема читается только для проверки, что токен есть в обеих.
const darkTokens = new Map()
flatten(JSON.parse(readFileSync(darkPath, 'utf8')), '', darkTokens)

/** Пути токенов по компонентам. */
const tokensByNamespace = new Map()
for (const path of lightTokens.keys()) {
  const namespace = path.split('/')[0]
  const list = tokensByNamespace.get(namespace) ?? []
  list.push(path)
  tokensByNamespace.set(namespace, list)
}

const byColorCache = new Map()
function tokensWithColor(namespace, color) {
  const cacheKey = `${namespace}\0${colorKey(color)}`
  const cached = byColorCache.get(cacheKey)
  if (cached) return cached
  const found = (tokensByNamespace.get(namespace) ?? []).filter(
    (path) => colorKey(colorOf(lightTokens.get(path))) === colorKey(color)
  )
  byColorCache.set(cacheKey, found)
  return found
}

function vocabularyOf(paths) {
  const vocabulary = new Set()
  for (const path of paths) {
    for (const segment of path.split('/').slice(1)) vocabulary.add(segment)
  }
  return vocabulary
}

/** Размерности варианта: значения свойств, которые есть в путях токенов. */
function variantDimensions(variantName, vocabulary) {
  const dimensions = []
  for (const part of variantName.split(',')) {
    const raw = part.includes('=') ? part.slice(part.indexOf('=') + 1) : part
    const slug = raw.trim().toLowerCase().replaceAll(' ', '-').replaceAll('_', '-')
    if (slug && vocabulary.has(slug)) dimensions.push(slug)
  }
  return dimensions
}

/** Состояние варианта: значение свойства State, иначе default. */
function stateOf(variantName, vocabulary) {
  for (const part of variantName.split(',')) {
    if (!part.includes('=')) continue
    const [key, value] = part.split('=')
    if (key.trim().toLowerCase() !== 'state') continue
    const slug = value.trim().toLowerCase().replaceAll(' ', '-')
    if (vocabulary.has(slug)) return slug
  }
  return 'default'
}

/**
 * Токен под цвет узла, его роль и размерности варианта.
 * Возвращает путь, `{ candidates }` при неоднозначности или null.
 */
function findToken(namespace, dimensions, role, state, color) {
  const candidates = tokensWithColor(namespace, color).filter((path) =>
    path.split('/').includes(role)
  )
  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0]

  const scored = candidates
    .map((path) => {
      const segments = path.split('/')
      let score = 0
      for (const dimension of dimensions) if (segments.includes(dimension)) score += 2
      if (segments[segments.length - 1] === state) score += 1
      if (path === `${namespace}/${role}/${state}`) score += 1
      return { path, score }
    })
    .sort((a, b) => b.score - a.score)

  if (scored.length > 1 && scored[0].score === scored[1].score) {
    return { candidates: scored.map((entry) => entry.path) }
  }
  return scored[0].path
}

// ── Проверка записанного файла ──────────────────────────────────────────────

if (verifyPath) {
  const bytes = new Uint8Array(readFileSync(verifyPath))
  const parsed = figPkg.parseFigBuffer(bytes.buffer)
  const graph = corePkg.importNodeChanges(parsed.nodeChanges, parsed.blobs, new Map(parsed.images), {
    populate: 'none'
  })
  const lightModeByCollection = new Map()
  for (const [id, collection] of graph.variableCollections) {
    const light = collection.modes.find((mode) => mode.name.toLowerCase() === 'light')
    lightModeByCollection.set(id, (light ?? collection.modes[0]).modeId)
  }
  const resolve = (variable) => {
    let value = variable.valuesByMode[lightModeByCollection.get(variable.collectionId)]
    if (value && typeof value === 'object' && 'aliasId' in value) {
      const target = graph.variables.get(value.aliasId)
      if (!target) return null
      value = target.valuesByMode[lightModeByCollection.get(target.collectionId)]
    }
    return value ?? null
  }

  let bound = 0
  let checked = 0
  let mismatch = 0
  const samples = []
  for (const node of graph.nodes.values()) {
    for (const [field, variableId] of Object.entries(node.boundVariables ?? {})) {
      bound += 1
      const variable = graph.variables.get(variableId)
      if (!variable) continue
      const value = resolve(variable)
      const paint = field.startsWith('strokes') ? (node.strokes ?? [])[0] : (node.fills ?? [])[0]
      if (!value || !paint?.color) continue
      checked += 1
      if (colorKey(value) !== colorKey(paint.color)) {
        mismatch += 1
        if (samples.length < 5) {
          samples.push(`${node.name.trim().slice(0, 36)} ${field} → ${variable.name}`)
        }
      }
    }
  }
  console.log(`проверено привязок: ${bound}, сверено цветов: ${checked}, расхождений: ${mismatch}`)
  for (const line of samples) console.log('  ' + line)
  process.exit(mismatch === 0 ? 0 : 1)
}

// ── Привязка ────────────────────────────────────────────────────────────────

const [input, output] = positional
if (!input) {
  console.error('нужен входной .fig')
  process.exit(1)
}

const bytes = new Uint8Array(await readFile(input))
const parsed = figPkg.parseFigBuffer(bytes.buffer)
const graph = corePkg.importNodeChanges(parsed.nodeChanges, parsed.blobs, new Map(parsed.images), {
  populate: 'all'
})

const variablesByName = new Map()
for (const variable of graph.variables.values()) variablesByName.set(variable.name, variable)

let bound = 0
const ambiguous = []
const unresolved = []
const examples = []
const perNamespace = new Map()

function statsOf(namespace) {
  let stats = perNamespace.get(namespace)
  if (!stats) {
    stats = { bound: 0, ambiguous: 0, unresolved: 0 }
    perNamespace.set(namespace, stats)
  }
  return stats
}

function bindNode(node, namespace, dimensions, role, field) {
  const stats = statsOf(namespace)
  const paint = field.startsWith('strokes') ? (node.strokes ?? [])[0] : (node.fills ?? [])[0]
  const color = paint?.color
  if (!color) {
    stats.unresolved += 1
    return
  }
  const found = findToken(namespace, dimensions, role, node.__state, color)
  if (!found) {
    stats.unresolved += 1
    unresolved.push(
      `${namespace}: ${node.name.trim().slice(0, 32)} → ${role}/${node.__state} (${hex(color)})`
    )
    return
  }
  if (typeof found !== 'string') {
    stats.ambiguous += 1
    ambiguous.push(
      `${namespace}: ${node.name.trim().slice(0, 32)} → ${role}: ${found.candidates.slice(0, 3).join(' | ')}`
    )
    return
  }
  const variable = variablesByName.get(found)
  if (!variable) {
    stats.unresolved += 1
    unresolved.push(`${namespace}: ${found} — нет такой переменной`)
    return
  }
  if (output) graph.bindVariable(node.id, field, variable.id)
  bound += 1
  stats.bound += 1
  if (examples.length < limit) {
    examples.push(`${node.name.trim().slice(0, 44)} → ${role} = ${found}`)
  }
}

const sets = [...graph.nodes.values()].filter((node) => node.type === 'COMPONENT_SET')
for (const set of sets) {
  const namespace = set.name.trim().toLowerCase()
  const paths = tokensByNamespace.get(namespace)
  if (!paths) continue
  const vocabulary = vocabularyOf(paths)
  const variants = (graph.getChildren(set.id) ?? []).filter((child) => child.type === 'COMPONENT')
  for (const variant of variants) {
    variant.__state = stateOf(variant.name, vocabulary)
    const dimensions = variantDimensions(variant.name, vocabulary)
    if ((variant.fills ?? []).length > 0) {
      bindNode(variant, namespace, dimensions, 'background', 'fills/0/color')
    }
    if ((variant.strokes ?? []).length > 0) {
      bindNode(variant, namespace, dimensions, 'border', 'strokes/0/color')
    }
    for (const child of graph.getChildren(variant.id) ?? []) {
      child.__state = variant.__state
      if (child.type === 'TEXT' && (child.fills ?? []).length > 0) {
        bindNode(child, namespace, dimensions, 'text', 'fills/0/color')
      }
      if (child.type === 'INSTANCE' && (child.fills ?? []).length > 0) {
        bindNode(child, namespace, dimensions, 'icon', 'fills/0/color')
      }
    }
  }
}

let boundNodes = 0
let boundFields = 0
for (const node of graph.nodes.values()) {
  const fields = Object.keys(node.boundVariables ?? {})
  if (fields.length === 0) continue
  boundNodes += 1
  boundFields += fields.length
}

console.log(`привязок ${output ? 'создано' : 'будет создано'}: ${bound}`)
if (output) console.log(`в графе: узлов с привязками ${boundNodes}, полей ${boundFields}`)
console.log(`не нашлось токена: ${unresolved.length}, неоднозначных: ${ambiguous.length}`)
void darkTokens
console.log('\nпримеры:')
for (const line of examples) console.log('  ' + line)
if (unresolved.length > 0) {
  console.log('\nбез токена такого цвета и роли (первые 6):')
  for (const line of unresolved.slice(0, 6)) console.log('  ' + line)
}
if (ambiguous.length > 0) {
  console.log('\nнеоднозначные (первые 5):')
  for (const line of ambiguous.slice(0, 5)) console.log('  ' + line)
}

console.log('\nпо компонентам (привязано / неоднозначно / без токена):')
for (const [namespace, stats] of [...perNamespace].sort((a, b) => b[1].bound - a[1].bound)) {
  console.log(
    `  ${namespace.padEnd(20)} ${String(stats.bound).padStart(5)} / ${String(stats.ambiguous).padStart(4)} / ${String(stats.unresolved).padStart(5)}`
  )
}

if (!output) process.exit(0)

releaseFigPopulationWorker(graph)
const exported = await exportFigFile(graph, undefined, undefined, undefined, false, {
  noImplicitInternalCanvas: true
})
await writeFile(
  output,
  Buffer.from(exported.buffer.slice(exported.byteOffset, exported.byteOffset + exported.byteLength))
)
console.log(`\nзаписано: ${output} (${Math.round(exported.byteLength / 1024)} КБ)`)
