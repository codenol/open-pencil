// Пометка слотов: контейнеры, которые наполняются готовым блоком.
//
// Слот — это именованный контейнер внутри мастера: `Main container`, `Slot`,
// `Top slot`, `statuses slot`. Его не наполняют узлами напрямую: узлы,
// добавленные в инстанс, на экране видны, но в файл не пишутся — вся работа
// теряется после сохранения. Правильный путь: собрать блок как компонент и
// подставить его в слот.
//
// Пометка живёт в pluginData узла, рядом с ним: едет вместе с компонентом
// в файле и в библиотеке, видна в панели свойств и в чтении узла.
//
// Что считается слотом: контейнер, чьё имя содержит `slot` либо равно
// `Main container`. Имена вариантов вроде `State=Default, Type=Custom slot`
// слотами не считаются — там слово slot часть значения свойства.
//
// Запуск: bun tools/ds/mark-slots.mjs <вход.fig> <выход.fig> [--check]
import { readFile, writeFile } from 'node:fs/promises'

import * as figPkg from '/opt/open-pencil-clean/packages/fig/dist/index.js'
import * as corePkg from '/opt/open-pencil-clean/packages/core/dist/index.js'
import { exportFigFile } from '/opt/open-pencil-clean/packages/core/dist/io/formats/fig/index.js'
import { releaseFigPopulationWorker } from '/opt/open-pencil-clean/packages/core/dist/kiwi/fig/population/client.js'

const [input, output, ...flags] = process.argv.slice(2)
const checkOnly = flags.includes('--check')

const PLUGIN_ID = 'norka.design-system'
const SLOT_KEY = 'slot'

/** Тип узла, который может быть слотом. */
const CONTAINER_TYPES = new Set(['FRAME', 'COMPONENT'])

/** Имя, по которому узел считается слотом. */
function isSlotName(name) {
  const trimmed = name.trim()
  // Имя варианта несёт значения свойств: `Property=Value`. Там слово slot
  // встречается как часть значения и слотом не является.
  if (trimmed.includes('=')) return false
  return /slot/i.test(trimmed) || /^main container$/i.test(trimmed)
}

const bytes = new Uint8Array(await readFile(input))
const parsed = figPkg.parseFigBuffer(bytes.buffer)
const graph = corePkg.importNodeChanges(parsed.nodeChanges, parsed.blobs, new Map(parsed.images), {
  populate: 'none'
})

let marked = 0
let already = 0

for (const node of [...graph.nodes.values()]) {
  if (!CONTAINER_TYPES.has(node.type)) continue
  if (!isSlotName(node.name)) continue

  const existing = node.pluginData.find(
    (item) => item.pluginId === PLUGIN_ID && item.key === SLOT_KEY
  )
  if (existing) {
    already += 1
    continue
  }

  if (checkOnly) {
    console.log(`слот без пометки: "${node.name.trim()}" ${Math.round(node.width)}x${Math.round(node.height)}`)
    marked += 1
    continue
  }

  const entry = { pluginId: PLUGIN_ID, key: SLOT_KEY, value: JSON.stringify({ role: 'slot' }) }
  graph.updateNode(node.id, { pluginData: [...node.pluginData, entry] })
  marked += 1
}

console.log(`размечено слотов: ${marked}, уже было: ${already}`)
if (checkOnly) process.exit(0)
if (marked === 0) {
  console.log('нечего менять')
  process.exit(0)
}

releaseFigPopulationWorker(graph)
const exported = await exportFigFile(graph, undefined, undefined, undefined, false, {
  noImplicitInternalCanvas: true
})
await writeFile(
  output,
  Buffer.from(exported.buffer.slice(exported.byteOffset, exported.byteOffset + exported.byteLength))
)
console.log(`записано: ${output} (${Math.round(exported.byteLength / 1024)} КБ)`)
