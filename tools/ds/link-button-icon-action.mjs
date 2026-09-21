// Связывает инстансы icon внутри сета `button-icon-action` с сетами иконок.
//
// В сете 90 вариантов; имя варианта содержит размер (Size=16 / Size=20),
// а внутри лежит пустой инстанс `icon`. Связываем каждый инстанс с вариантом
// сета `icon` того же размера — размер берём из имени варианта.
//
// Запуск: bun tools/ds/link-button-icon-action.mjs <вход> <выход>
import { readFile, writeFile } from 'node:fs/promises'

import * as figPkg from '/opt/open-pencil-clean/packages/fig/dist/index.js'
import * as corePkg from '/opt/open-pencil-clean/packages/core/dist/index.js'
import { exportFigFile } from '/opt/open-pencil-clean/packages/core/dist/io/formats/fig/index.js'
import { populateAndApplyOverrides } from '/opt/open-pencil-clean/packages/fig/dist/instance-overrides.js'
import { releaseOriginalFigArchive } from '/opt/open-pencil-clean/packages/core/dist/kiwi/fig/session/original-archive.js'

const [input, output, setName = 'button-icon-action'] = process.argv.slice(2)
if (!input || !output) {
  console.error('нужно: bun tools/ds/link-button-icon-action.mjs <вход> <выход> [имя сета]')
  process.exit(1)
}

const bytes = new Uint8Array(await readFile(input))
const parsed = figPkg.parseFigBuffer(bytes.buffer)
const graph = corePkg.importNodeChanges(parsed.nodeChanges, parsed.blobs, new Map(parsed.images), {
  populate: 'none'
})

// Сет иконок: размер → вариант.
const iconSet = [...graph.nodes.values()].find(
  (node) => node.type === 'COMPONENT_SET' && node.name.trim() === 'icon'
)
if (!iconSet) {
  console.error('сет "icon" не найден')
  process.exit(1)
}
const iconBySize = new Map()
for (const id of iconSet.childIds) {
  const variant = graph.getNode(id)
  const match = variant?.name.trim().match(/^Size=(\d+)$/)
  if (match) iconBySize.set(match[1], variant)
}
console.log('доступные размеры иконок:', [...iconBySize.keys()].join(', '))

// Целевой сет.
const target = [...graph.nodes.values()].find(
  (node) => node.type === 'COMPONENT_SET' && node.name.trim() === setName
)
if (!target) {
  console.error(`сет "${setName}" не найден`)
  process.exit(1)
}

const plan = []
let skipped = 0
for (const variantId of target.childIds) {
  const variant = graph.getNode(variantId)
  if (!variant) continue
  // Размер из имени варианта: "State=Default, Size=16, Sentiment=Accent".
  const sizeMatch = variant.name.match(/Size=(\d+)/)
  const size = sizeMatch?.[1] ?? '16'
  const master = iconBySize.get(size) ?? iconBySize.get('16')
  if (!master) continue

  for (const childId of variant.childIds) {
    const child = graph.getNode(childId)
    if (child?.type !== 'INSTANCE' || child.componentId) {
      if (child?.type === 'INSTANCE') skipped += 1
      continue
    }
    plan.push({ instance: child, master, size, variant: variant.name.trim() })
  }
}

console.log(`вариантов: ${target.childIds.length} | иконок к связке: ${plan.length} | уже связаны: ${skipped}`)
const bySize = new Map()
for (const item of plan) bySize.set(item.size, (bySize.get(item.size) ?? 0) + 1)
for (const [size, count] of [...bySize.entries()].sort()) console.log(`  Size=${size}: ${count}`)

for (const item of plan) {
  graph.updateNode(item.instance.id, { componentId: item.master.id })
}

populateAndApplyOverrides(
  graph,
  new Map(),
  new Map(plan.map((item) => [item.instance.id, item.instance.id]))
)

let filled = 0
for (const item of plan) {
  if ((graph.getNode(item.instance.id)?.childIds.length ?? 0) > 0) filled += 1
  else console.log(`  не наполнился: ${item.instance.id} в "${item.variant}"`)
}
console.log(`\nнаполнено: ${filled} из ${plan.length}`)

releaseOriginalFigArchive(graph)
const exported = await exportFigFile(graph, undefined, undefined, undefined, false, {
  noImplicitInternalCanvas: true
})
await writeFile(
  output,
  Buffer.from(exported.buffer.slice(exported.byteOffset, exported.byteOffset + exported.byteLength))
)
console.log(`записано: ${output} (${Math.round(exported.byteLength / 1024)} КБ)`)
