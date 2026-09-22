// Снятие лишних меток слота.
//
// Задача про карточки: ассистент наплодил рабочие копии (`Layout copy`,
// `content`), мой скрипт разметки прошёл и по ним, и метка слота расползлась
// по файлу — 430 вместо 84. Копии он потом убрал, а метки остались висеть.
//
// Слот — это место в мастер-компоненте, а не в рабочей копии. Снимаем метку
// со всего, что лежит вне мастеров: у копий инстансов слот живёт в мастере,
// и метка там уже есть.
//
// Запуск: bun tools/ds/prune-slots.mjs <вход.fig> <выход.fig> [--check]
import { readFile, writeFile } from 'node:fs/promises'

import * as figPkg from '/opt/open-pencil-clean/packages/fig/dist/index.js'
import * as corePkg from '/opt/open-pencil-clean/packages/core/dist/index.js'
import { exportFigFile } from '/opt/open-pencil-clean/packages/core/dist/io/formats/fig/index.js'
import { releaseFigPopulationWorker } from '/opt/open-pencil-clean/packages/core/dist/kiwi/fig/population/client.js'

const [input, output, ...flags] = process.argv.slice(2)
const checkOnly = flags.includes('--check')

const PLUGIN_ID = 'norka.design-system'
const SLOT_KEY = 'slot'

const bytes = new Uint8Array(await readFile(input))
const parsed = figPkg.parseFigBuffer(bytes.buffer)
const graph = corePkg.importNodeChanges(parsed.nodeChanges, parsed.blobs, new Map(parsed.images), {
  populate: 'none'
})

/**
 * Лежит ли узел внутри мастера.
 *
 * Мастер это компонент или сет вариантов. Всё остальное — рабочие копии:
 * страницы, фреймы, инстансы. У инстанса слот живёт в его мастере, поэтому
 * метка на самом инстансе — дубль.
 */
function isInsideMaster(id) {
  let current = graph.getNode(id)
  while (current?.parentId) {
    const parent = graph.getNode(current.parentId)
    if (!parent) break
    if (parent.type === 'COMPONENT' || parent.type === 'COMPONENT_SET') return true
    current = parent
  }
  return false
}

let kept = 0
let removed = 0
const touched = []

for (const node of [...graph.nodes.values()]) {
  const entry = node.pluginData?.find((item) => item.pluginId === PLUGIN_ID && item.key === SLOT_KEY)
  if (!entry) continue
  if (isInsideMaster(node.id)) {
    kept += 1
    continue
  }
  removed += 1
  touched.push(`${node.name.trim()} (${node.id})`)
  if (checkOnly) continue
  graph.updateNode(node.id, {
    pluginData: node.pluginData.filter(
      (item) => !(item.pluginId === PLUGIN_ID && item.key === SLOT_KEY)
    )
  })
}

console.log(`оставлено слотов в мастерах: ${kept}`)
console.log(`снято с рабочих копий: ${removed}`)
if (checkOnly && touched.length > 0) {
  for (const item of touched.slice(0, 8)) console.log(`  лишняя метка: ${item}`)
}
if (checkOnly) process.exit(0)

releaseFigPopulationWorker(graph)
const exported = await exportFigFile(graph, undefined, undefined, undefined, false, {
  noImplicitInternalCanvas: true
})
await writeFile(
  output,
  Buffer.from(exported.buffer.slice(exported.byteOffset, exported.byteOffset + exported.byteLength))
)
console.log(`записано: ${output} (${Math.round(exported.byteLength / 1024)} КБ)`)
