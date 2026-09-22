// Ширина бейджа считается по содержимому, а не стоит числом.
//
// Разобрано по факту: у всех 70 вариантов сета `status` главная ось стояла
// FIXED — ширина задана жёстко. При смене подписи бейдж оставался прежним:
// «Работает» и «Высокая нагрузка» занимали одинаковое место.
//
// Ассистент это заметил и обошёл — зафиксировал размеры по замеренным
// значениям. Правильно наоборот: ширина идёт от подписи.
//
// Родственные наборы (badge, chip, button, button-icon-action) уже считают
// ширину по содержимому — приводим бейджи статусов к тому же поведению.
//
// Высоту не трогаем: она задаёт размер пилюли.
//
// Запуск: bun tools/ds/badge-hug-width.mjs <вход.fig> <выход.fig> [--check]
import { readFile, writeFile } from 'node:fs/promises'

import * as figPkg from '/opt/open-pencil-clean/packages/fig/dist/index.js'
import * as corePkg from '/opt/open-pencil-clean/packages/core/dist/index.js'
import { exportFigFile } from '/opt/open-pencil-clean/packages/core/dist/io/formats/fig/index.js'
import { releaseFigPopulationWorker } from '/opt/open-pencil-clean/packages/core/dist/kiwi/fig/population/client.js'

const [input, output, ...flags] = process.argv.slice(2)
const checkOnly = flags.includes('--check')

/** Сеты, у которых ширина должна идти от подписи. */
const CONTENT_SIZED_SETS = ['status', 'status-dot']

const bytes = new Uint8Array(await readFile(input))
const parsed = figPkg.parseFigBuffer(bytes.buffer)
const graph = corePkg.importNodeChanges(parsed.nodeChanges, parsed.blobs, new Map(parsed.images), {
  populate: 'none'
})

function pageOf(node) {
  let current = node
  while (current?.parentId) {
    current = graph.getNode(current.parentId)
    if (current?.type === 'CANVAS') return current.name
  }
  return ''
}

let changed = 0
let checked = 0

for (const setName of CONTENT_SIZED_SETS) {
  const sets = [...graph.nodes.values()].filter(
    (node) => node.type === 'COMPONENT_SET' && node.name.trim() === setName
  )
  for (const set of sets) {
    for (const variantId of set.childIds) {
      const variant = graph.getNode(variantId)
      if (!variant || variant.layoutMode === 'NONE') continue
      checked += 1

      const widthField = variant.layoutMode === 'VERTICAL' ? 'counterAxisSizing' : 'primaryAxisSizing'
      if (variant[widthField] === 'HUG') continue

      if (checkOnly) {
        console.log(
          `нужна правка: "${variant.name.trim().slice(0, 44)}" ` +
            `ширина=${Math.round(variant.width)} ${widthField}=${variant[widthField]}`
        )
        continue
      }

      graph.updateNode(variantId, { [widthField]: 'HUG' })
      changed += 1
    }
  }
}

console.log(`проверено вариантов: ${checked}, правок: ${changed}`)
if (checkOnly) process.exit(0)
if (changed === 0) {
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
