// Импорт токенов Figma в переменные документа.
//
// Файлы — экспорт Figma Variables по режимам: у корня лежит
// `$extensions.com.figma.modeName` («Dark» / «Light»), а каждый токен несёт
// разрешённое значение и, если он ссылается на палитру, — `com.figma.aliasData`
// с именем и id цели. Сама палитра в экспорт не попадает, но её значения
// выводятся из ссылок: каждое имя палитры встречается с одним и тем же цветом
// и не зависит от темы.
//
// Запуск:
//   bun tools/ds/import-tokens.mjs <вход.fig> <выход.fig> \
//     --dark=Dark.tokens.json --light=Light.tokens.json \
//     [--collection=Theme] [--palette=Pallete]
//
// Проверка записанного файла против исходных токенов:
//   bun tools/ds/import-tokens.mjs --verify=<файл.fig> \
//     --dark=Dark.tokens.json --light=Light.tokens.json
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
const collectionName = flag('collection', 'Theme')
const paletteName = flag('palette', 'Pallete')

if (!darkPath || !lightPath) {
  console.error('нужны --dark=<файл> и --light=<файл>')
  process.exit(1)
}

/** Плоский список токенов: путь → сам токен. */
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

function readTokens(raw, modeName) {
  const parsed = JSON.parse(raw)
  const mode = parsed?.$extensions?.['com.figma.modeName'] ?? modeName
  const tokens = new Map()
  flatten(parsed, '', tokens)
  return { mode, tokens }
}

const { readFileSync } = await import('node:fs')
const dark = readTokens(readFileSync(darkPath, 'utf8'), 'Dark')
const light = readTokens(readFileSync(lightPath, 'utf8'), 'Light')

/** Цвет токена в виде, который понимает граф. */
function colorOf(token) {
  const value = token?.$value ?? {}
  const [r = 0, g = 0, b = 0] = value.components ?? []
  return { r, g, b, a: typeof value.alpha === 'number' ? value.alpha : 1 }
}

const extensionsOf = (token) => token?.$extensions ?? {}
const aliasOf = (token) => extensionsOf(token)['com.figma.aliasData']

/** Палитра: имя → значение и id. Значения не зависят от темы. */
function collectPalette() {
  const palette = new Map()
  const conflicts = []
  for (const [mode, source] of [
    ['тёмная', dark],
    ['светлая', light]
  ]) {
    for (const [path, token] of source.tokens) {
      const alias = aliasOf(token)
      if (!alias?.targetVariableName) continue
      const name = alias.targetVariableName
      const color = colorOf(token)
      const known = palette.get(name)
      if (!known) {
        palette.set(name, { id: alias.targetVariableId ?? `VariableID:palette/${name}`, color })
        continue
      }
      if (
        known.color.r !== color.r ||
        known.color.g !== color.g ||
        known.color.b !== color.b ||
        known.color.a !== color.a
      ) {
        conflicts.push({ name, mode, path })
      }
    }
  }
  return { palette, conflicts }
}

const { palette, conflicts } = collectPalette()

if (verifyPath) {
  const bytes = new Uint8Array(readFileSync(verifyPath))
  const parsed = figPkg.parseFigBuffer(bytes.buffer)
  const graph = corePkg.importNodeChanges(parsed.nodeChanges, parsed.blobs, new Map(parsed.images), {
    populate: 'none'
  })
  const byName = new Map()
  for (const [id, variable] of graph.variables) {
    byName.set(`${variable.collectionId}\0${variable.name}`, { id, variable })
  }
  const collectionsByName = new Map()
  for (const [id, collection] of graph.variableCollections) {
    collectionsByName.set(collection.name, { id, collection })
  }

  const theme = collectionsByName.get(collectionName)
  const paletteCollection = collectionsByName.get(paletteName)
  if (!theme || !paletteCollection) {
    console.error(
      `в файле нет коллекций: ${!paletteCollection ? paletteName + ' ' : ''}${!theme ? collectionName : ''}`
    )
    process.exit(1)
  }
  const modeByName = new Map(theme.collection.modes.map((mode) => [mode.name, mode.modeId]))
  const paletteIdToName = new Map()
  for (const variableId of paletteCollection.collection.variableIds) {
    const variable = graph.variables.get(variableId)
    if (variable) paletteIdToName.set(variableId, variable.name)
  }

  /** Значение переменной с учётом ссылки на палитру. */
  const resolve = (value) => {
    if (value && typeof value === 'object' && 'aliasId' in value) {
      const target = graph.variables.get(value.aliasId)
      const targetValue = target?.valuesByMode[Object.keys(target.valuesByMode)[0]]
      return targetValue ? { color: targetValue, alias: target.name } : null
    }
    return value ? { color: value, alias: null } : null
  }

  let checked = 0
  let mismatches = 0
  for (const [modeName, source] of [
    ['Dark', dark],
    ['Light', light]
  ]) {
    const modeId = modeByName.get(modeName)
    if (!modeId) {
      console.error(`нет режима ${modeName}`)
      process.exit(1)
    }
    for (const [path, token] of source.tokens) {
      const found = byName.get(`${theme.id}\0${path}`)
      if (!found) {
        console.error(`нет переменной ${path}`)
        mismatches += 1
        continue
      }
      const resolved = resolve(found.variable.valuesByMode[modeId])
      if (!resolved) {
        console.error(`нет значения ${path} в режиме ${modeName}`)
        mismatches += 1
        continue
      }
      const expected = colorOf(token)
      const actual = resolved.color
      const close = (a, b) => Math.abs(a - b) < 0.004
      if (
        !close(expected.r, actual.r) ||
        !close(expected.g, actual.g) ||
        !close(expected.b, actual.b) ||
        !close(expected.a, actual.a ?? 1)
      ) {
        console.error(`цвет не совпал: ${path} (${modeName})`)
        mismatches += 1
        continue
      }
      const alias = aliasOf(token)
      if (alias?.targetVariableName && resolved.alias !== alias.targetVariableName) {
        console.error(
          `ссылка не совпала: ${path} (${modeName}) — ждали ${alias.targetVariableName}, в файле ${resolved.alias}`
        )
        mismatches += 1
        continue
      }
      checked += 1
    }
  }
  console.log(
    `проверено значений: ${checked}, расхождений: ${mismatches} | коллекции: ${paletteName} (${paletteCollection.collection.variableIds.length}), ${collectionName} (${theme.collection.variableIds.length}), режимы ${theme.collection.modes.map((m) => m.name).join('/')}`
  )
  process.exit(mismatches === 0 ? 0 : 1)
}

const [input, output] = positional
if (!input || !output) {
  console.error('нужны входной и выходной .fig')
  process.exit(1)
}

const bytes = new Uint8Array(await readFile(input))
const parsed = figPkg.parseFigBuffer(bytes.buffer)
const graph = corePkg.importNodeChanges(parsed.nodeChanges, parsed.blobs, new Map(parsed.images), {
  populate: 'none'
})

// Повторный запуск не должен плодить двойников: коллекции с теми же именами
// убираем вместе с их переменными.
for (const [id, collection] of [...graph.variableCollections]) {
  if (collection.name !== paletteName && collection.name !== collectionName) continue
  for (const variableId of collection.variableIds) graph.variables.delete(variableId)
  graph.variableCollections.delete(id)
}

const PALETTE_MODE = 'palette-value'
const LIGHT_MODE = 'theme-light'
const DARK_MODE = 'theme-dark'

graph.addCollection({
  id: 'VariableCollection:palette',
  name: paletteName,
  modes: [{ modeId: PALETTE_MODE, name: 'Value' }],
  defaultModeId: PALETTE_MODE,
  variableIds: []
})

const paletteIdByName = new Map()
for (const [name, entry] of palette) {
  const id = entry.id
  paletteIdByName.set(name, id)
  graph.addVariable({
    id,
    name,
    type: 'COLOR',
    collectionId: 'VariableCollection:palette',
    valuesByMode: { [PALETTE_MODE]: entry.color },
    description: '',
    hiddenFromPublishing: false
  })
}

graph.addCollection({
  id: 'VariableCollection:theme',
  name: collectionName,
  modes: [
    { modeId: LIGHT_MODE, name: 'Light' },
    { modeId: DARK_MODE, name: 'Dark' }
  ],
  defaultModeId: LIGHT_MODE,
  variableIds: []
})

let aliased = 0
let literal = 0
let perModeDifferent = 0
for (const [path, darkToken] of dark.tokens) {
  const lightToken = light.tokens.get(path)
  if (!lightToken) continue

  const valueFor = (token, mode) => {
    const alias = aliasOf(token)
    const targetId = alias?.targetVariableName ? paletteIdByName.get(alias.targetVariableName) : null
    if (targetId) return { aliasId: targetId }
    if (mode === 'dark') literal += 1
    return colorOf(token)
  }

  const darkValue = valueFor(darkToken, 'dark')
  const lightValue = valueFor(lightToken, 'light')
  if ('aliasId' in darkValue) aliased += 1
  const darkAlias = 'aliasId' in darkValue ? darkValue.aliasId : null
  const lightAlias = 'aliasId' in lightValue ? lightValue.aliasId : null
  if (darkAlias !== lightAlias) perModeDifferent += 1

  const id = extensionsOf(darkToken)['com.figma.variableId'] ?? `VariableID:theme/${path}`
  graph.addVariable({
    id,
    name: path,
    type: 'COLOR',
    collectionId: 'VariableCollection:theme',
    valuesByMode: { [DARK_MODE]: darkValue, [LIGHT_MODE]: lightValue },
    description: '',
    hiddenFromPublishing: false
  })
}

console.log(`палитра: ${palette.size} переменных (набор «${paletteName}»)`)
console.log(
  `семантика: ${graph.variableCollections.get('VariableCollection:theme').variableIds.length} переменных в «${collectionName}», режимы Light/Dark`
)
console.log(`ссылок на палитру: ${aliased}, литеральных: ${literal}`)
console.log(`в тёмной и светлой ссылаются на разные значения: ${perModeDifferent}`)
if (conflicts.length > 0) {
  console.log(`\nвнимание: у ${conflicts.length} ссылок значение расходится между темами:`)
  for (const conflict of conflicts.slice(0, 5)) {
    console.log(`  ${conflict.name} — ${conflict.path} (${conflict.mode})`)
  }
}

releaseFigPopulationWorker(graph)
const exported = await exportFigFile(graph, undefined, undefined, undefined, false, {
  noImplicitInternalCanvas: true
})
await writeFile(output, Buffer.from(exported.buffer.slice(exported.byteOffset, exported.byteOffset + exported.byteLength)))
console.log(`записано: ${output} (${Math.round(exported.byteLength / 1024)} КБ)`)
