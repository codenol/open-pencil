// Связывает разорванные инстансы одной группы с выбранным мастером.
//
// Точечная правка: правим одну связь за раз, чтобы проверять результат
// и обновлять граф. Имя инстанса и имя варианта мастера задаются аргументами.
//
// Запуск: bun tools/ds/relink-group.mjs <вход> <выход> <имя инстанса> [имя варианта]
import { readFile, writeFile } from 'node:fs/promises'

import * as figPkg from '/opt/open-pencil-clean/packages/fig/dist/index.js'
import * as corePkg from '/opt/open-pencil-clean/packages/core/dist/index.js'
import { exportFigFile } from '/opt/open-pencil-clean/packages/core/dist/io/formats/fig/index.js'
import { populateAndApplyOverrides } from '/opt/open-pencil-clean/packages/fig/dist/instance-overrides.js'
import { releaseOriginalFigArchive } from '/opt/open-pencil-clean/packages/core/dist/kiwi/fig/session/original-archive.js'

const [input, output, instanceName, variantName] = process.argv.slice(2)
if (!input || !output || !instanceName) {
  console.error('нужно: bun tools/ds/relink-group.mjs <вход> <выход> <имя инстанса> [имя варианта]')
  process.exit(1)
}

const bytes = new Uint8Array(await readFile(input))
const parsed = figPkg.parseFigBuffer(bytes.buffer)
const graph = corePkg.importNodeChanges(parsed.nodeChanges, parsed.blobs, new Map(parsed.images), {
  populate: 'none'
})

// Ищем мастер: либо вариант сета с нужным именем, либо компонент/сет.
const units = [...graph.nodes.values()].filter(
  (node) => node.type === 'COMPONENT' || node.type === 'COMPONENT_SET'
)

let master = null
if (variantName) {
  master =
    units.find(
      (node) => node.type === 'COMPONENT' && node.name.trim() === variantName &&
        graph.getNode(node.parentId)?.name?.trim() === instanceName
    ) ?? null
  if (!master) {
    // Вариант мог быть назван иначе — ищем по вхождению.
    master = units.find(
      (node) =>
        node.type === 'COMPONENT' &&
        node.name.includes(variantName) &&
        graph.getNode(node.parentId)?.name?.trim() === instanceName
    )
  }
}
if (!master) {
  master =
    units.find((node) => node.name.trim() === instanceName && node.childIds.length > 0) ??
    units.find((node) => node.name.trim() === instanceName) ??
    null
}
if (!master) {
  console.error(`мастер "${instanceName}" не найден`)
  process.exit(1)
}

const orphans = [...graph.nodes.values()].filter(
  (node) =>
    node.type === 'INSTANCE' && node.name.trim() === instanceName && !node.componentId
)

console.log(`мастер: ${master.id} "${master.name.trim()}" (${master.type}, детей ${master.childIds.length})`)
console.log(`разорванных инстансов "${instanceName}": ${orphans.length}`)

for (const instance of orphans) {
  graph.updateNode(instance.id, { componentId: master.id })
}

populateAndApplyOverrides(
  graph,
  new Map(),
  new Map(orphans.map((instance) => [instance.id, instance.id]))
)

let filled = 0
for (const instance of orphans) {
  if ((graph.getNode(instance.id)?.childIds.length ?? 0) > 0) filled += 1
}
console.log(`наполнено: ${filled} из ${orphans.length}`)

releaseOriginalFigArchive(graph)
const exported = await exportFigFile(graph, undefined, undefined, undefined, false, {
  noImplicitInternalCanvas: true
})
await writeFile(
  output,
  Buffer.from(exported.buffer.slice(exported.byteOffset, exported.byteOffset + exported.byteLength))
)
console.log(`записано: ${output} (${Math.round(exported.byteLength / 1024)} КБ)`)
