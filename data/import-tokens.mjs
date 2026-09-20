// Импорт цветовых токенов из Figma (Light/Dark DTCG JSON) в файл OpenPencil:
// коллекция «Pallete» (примитивы) + коллекция «Components» с режимами Light/Dark (алиасы).
import { readFile } from 'node:fs/promises'
import { exportFigFile } from '/opt/open-pencil/packages/core/dist/io/formats/fig/index.js'
import { SceneGraph, generateId } from '/opt/open-pencil/packages/scene-graph/dist/index.js'
import {
  addMode,
  createCollection,
  createVariable,
  renameMode
} from '/opt/open-pencil/packages/scene-graph/dist/variables.js'

const LIGHT = '/root/.hermes/cache/documents/doc_5b952e51eaf4_Light.tokens.json'
const DARK = '/root/.hermes/cache/documents/doc_ea6811808e1f_Dark.tokens.json'

const lightFile = JSON.parse(await readFile(LIGHT, 'utf8'))
const darkFile = JSON.parse(await readFile(DARK, 'utf8'))

function collectLeaves(object, path = '', out = {}) {
  for (const [key, value] of Object.entries(object)) {
    if (key === '$extensions') continue
    const next = path ? `${path}.${key}` : key
    if (value && typeof value === 'object' && '$value' in value) out[next] = value
    else if (value && typeof value === 'object') collectLeaves(value, next, out)
  }
  return out
}

function toColor(value) {
  const [r = 0, g = 0, b = 0] = value.components ?? []
  return { r, g, b, a: value.alpha ?? 1 }
}

const lightLeaves = collectLeaves(lightFile)
const darkLeaves = collectLeaves(darkFile)

const primitives = new Map()
for (const leaf of [...Object.values(lightLeaves), ...Object.values(darkLeaves)]) {
  const alias = leaf.$extensions?.['com.figma.aliasData']
  if (!alias?.targetVariableName) continue
  if (!primitives.has(alias.targetVariableName)) {
    primitives.set(alias.targetVariableName, toColor(leaf.$value))
  }
}

const graph = new SceneGraph()

// Коллекция «Pallete» — примитивы палитры
const pallete = createCollection(graph, generateId, 'Pallete')
const primitiveIds = new Map()
for (const [name, color] of primitives) {
  const variable = createVariable(graph, generateId, name, 'COLOR', pallete.id, color)
  primitiveIds.set(name, variable.id)
}

// Коллекция «Components» — компонентные токены, два режима (Light/Dark), значения — алиасы на палитру
const components = createCollection(graph, generateId, 'Components')
const lightModeId = components.modes[0].modeId
renameMode(graph, components.id, lightModeId, 'Light')
const darkModeId = generateId()
addMode(graph, components.id, darkModeId, 'Dark')

let imported = 0
let skipped = 0
for (const [tokenPath, token] of Object.entries(lightLeaves)) {
  const name = tokenPath.split('.').join('/')
  const lightAlias = token.$extensions?.['com.figma.aliasData']?.targetVariableName
  const darkAlias = darkLeaves[tokenPath]?.$extensions?.['com.figma.aliasData']?.targetVariableName
  const lightTarget = lightAlias ? primitiveIds.get(lightAlias) : undefined
  const darkTarget = darkAlias ? primitiveIds.get(darkAlias) : lightTarget
  if (!lightTarget) {
    skipped += 1
    continue
  }
  const variable = createVariable(graph, generateId, name, 'COLOR', components.id, {
    aliasId: lightTarget
  })
  variable.valuesByMode[lightModeId] = { aliasId: lightTarget }
  variable.valuesByMode[darkModeId] = { aliasId: darkTarget ?? lightTarget }
  imported += 1
}

console.log(`примитивов: ${primitives.size}, токенов: ${imported} (пропущено ${skipped})`)

// Сохраняем как файл на сервере
const pageId = graph.getPages()[0].id
const bytes = await exportFigFile(graph, undefined, undefined, pageId)
console.log('fig-файл собран:', bytes.byteLength, 'байт')

const response = await fetch('https://html.norka.cc/api/files/tokens-color', {
  method: 'PUT',
  headers: {
    'x-document-name': encodeURIComponent('Цветовые токены'),
    'x-document-updated': new Date().toISOString()
  },
  body: bytes
})
console.log('загрузка на сервер:', response.status, await response.text())
