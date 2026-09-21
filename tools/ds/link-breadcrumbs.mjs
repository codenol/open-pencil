// Связывает инстансы компонентов со страницы breadcrumbs с их мастерами.
//
// На странице `breadcrumbs` лежат:
//  - сет `tab` (6 вариантов) и 15 пустых инстансов `tab` в компонентах `lots=*`
//  - внутри вариантов `Type=Dropdown` — пустые инстансы `icon`
//
// Скрипт:
//  1. инстансы `tab` → вариант `State=Default, Type=Text` сета `tab`
//     (нейтральный вид для «хлебных крошек»)
//  2. инстансы `icon` внутри сета `tab` → вариант Size=16 сета `icon`
//
// Запуск: bun tools/ds/link-breadcrumbs.mjs <вход> <выход>
import { readFile, writeFile } from 'node:fs/promises'

import * as figPkg from '/opt/open-pencil-clean/packages/fig/dist/index.js'
import * as corePkg from '/opt/open-pencil-clean/packages/core/dist/index.js'
import { exportFigFile } from '/opt/open-pencil-clean/packages/core/dist/io/formats/fig/index.js'
import { populateAndApplyOverrides } from '/opt/open-pencil-clean/packages/fig/dist/instance-overrides.js'
import { releaseOriginalFigArchive } from '/opt/open-pencil-clean/packages/core/dist/kiwi/fig/session/original-archive.js'

const [input, output] = process.argv.slice(2)
if (!input || !output) {
  console.error('нужно: bun tools/ds/link-breadcrumbs.mjs <вход> <выход>')
  process.exit(1)
}

const bytes = new Uint8Array(await readFile(input))
const parsed = figPkg.parseFigBuffer(bytes.buffer)
const graph = corePkg.importNodeChanges(parsed.nodeChanges, parsed.blobs, new Map(parsed.images), {
  populate: 'none'
})

/** Вариант сета по точному имени. */
function variantOf(setName, variantName) {
  const set = [...graph.nodes.values()].find(
    (node) => node.type === 'COMPONENT_SET' && node.name.trim() === setName
  )
  if (!set) return null
  return (
    set.childIds
      .map((id) => graph.getNode(id))
      .find((variant) => variant?.name.trim() === variantName) ?? null
  )
}

/** Все инстансы с именем без ссылки на мастер, начиная от корня. */
function orphanInstances(name) {
  return [...graph.nodes.values()].filter(
    (node) => node.type === 'INSTANCE' && node.name.trim() === name && !node.componentId
  )
}

const plan = []

// 1. Инстансы tab → нейтральный вариант сета tab.
const tabMaster = variantOf('tab', 'State=Default, Type=Text')
const tabInstances = orphanInstances('tab')
if (tabMaster) plan.push({ label: 'инстансы tab', master: tabMaster, instances: tabInstances })
else console.error('не найден вариант tab «State=Default, Type=Text»')

// 2. Инстансы icon (внутри вариантов tab) → Size=16 сета icon.
const iconMaster = variantOf('icon', 'Size=16')
const iconInstances = orphanInstances('icon')
if (iconMaster) plan.push({ label: 'инстансы icon', master: iconMaster, instances: iconInstances })
else console.error('не найден вариант icon «Size=16»')

const allOrphans = []
for (const step of plan) {
  console.log(`\n${step.label}: ${step.instances.length} → мастер ${step.master.id} "${step.master.name}"`)
  for (const instance of step.instances) {
    graph.updateNode(instance.id, { componentId: step.master.id })
    allOrphans.push(instance)
  }
}

// Наполняем так же, как при импорте Figma.
populateAndApplyOverrides(
  graph,
  new Map(),
  new Map(allOrphans.map((instance) => [instance.id, instance.id]))
)

let filled = 0
for (const instance of allOrphans) {
  if ((graph.getNode(instance.id)?.childIds.length ?? 0) > 0) filled += 1
  else console.log(`  не наполнился: ${instance.id} "${instance.name}"`)
}
console.log(`\nнаполнено: ${filled} из ${allOrphans.length}`)

releaseOriginalFigArchive(graph)
const exported = await exportFigFile(graph, undefined, undefined, undefined, false, {
  noImplicitInternalCanvas: true
})
await writeFile(
  output,
  Buffer.from(exported.buffer.slice(exported.byteOffset, exported.byteOffset + exported.byteLength))
)
console.log(`записано: ${output} (${Math.round(exported.byteLength / 1024)} КБ)`)
