// Связывает инстансы иконок внутри компонентов с самим сетом иконки.
//
// В сете `button` 480 вариантов содержат инстанс `icon` без ссылки на мастер:
// componentId пустой, содержимого нет — иконки в кнопках не отрисовываются.
// Скрипт связывает их с вариантом сета `icon` подходящего размера.
//
// Запуск: bun tools/ds/link-icon-instances.mjs <вход> <выход> [имя инстанса] [размер]
import { readFile, writeFile } from 'node:fs/promises'

import * as figPkg from '/opt/open-pencil-clean/packages/fig/dist/index.js'
import * as corePkg from '/opt/open-pencil-clean/packages/core/dist/index.js'
import { exportFigFile } from '/opt/open-pencil-clean/packages/core/dist/io/formats/fig/index.js'
import { populateAndApplyOverrides } from '/opt/open-pencil-clean/packages/fig/dist/instance-overrides.js'
import { releaseOriginalFigArchive } from '/opt/open-pencil-clean/packages/core/dist/kiwi/fig/session/original-archive.js'

const [input, output, targetName = 'icon', size = '16'] = process.argv.slice(2)
if (!input || !output) {
  console.error('нужно: bun tools/ds/link-icon-instances.mjs <вход> <выход> [имя] [размер]')
  process.exit(1)
}

const bytes = new Uint8Array(await readFile(input))
const parsed = figPkg.parseFigBuffer(bytes.buffer)
const graph = corePkg.importNodeChanges(parsed.nodeChanges, parsed.blobs, new Map(parsed.images), {
  populate: 'none'
})

// Мастер — вариант сета `icon` нужного размера.
const iconSet = [...graph.nodes.values()].find(
  (node) => node.type === 'COMPONENT_SET' && node.name.trim() === targetName
)
if (!iconSet) {
  console.error(`сет "${targetName}" не найден`)
  process.exit(1)
}

const master =
  iconSet.childIds
    .map((id) => graph.getNode(id))
    .find((variant) => variant?.name.trim() === `Size=${size}`) ??
  iconSet.childIds
    .map((id) => graph.getNode(id))
    .find((variant) => /Size=16/i.test(variant?.name ?? ''))
if (!master) {
  console.error(`вариант Size=${size} не найден`)
  process.exit(1)
}

// Сироты — инстансы с этим именем, но без ссылки на мастер.
const orphans = [...graph.nodes.values()].filter(
  (node) => node.type === 'INSTANCE' && node.name.trim() === targetName && !node.componentId
)

console.log(`мастер: ${master.id} "${master.name}" (${Math.round(master.width)}x${Math.round(master.height)})`)
console.log(`сирот: ${orphans.length}`)

for (const instance of orphans) {
  graph.updateNode(instance.id, { componentId: master.id })
}

// Наполняем так же, как при импорте Figma: связка родитель→клон + содержимое.
populateAndApplyOverrides(
  graph,
  new Map(),
  new Map(orphans.map((instance) => [instance.id, instance.id]))
)

let linked = 0
for (const instance of orphans) {
  const after = graph.getNode(instance.id)
  if ((after?.childIds.length ?? 0) > 0) linked += 1
}
console.log(`наполнено: ${linked} из ${orphans.length}`)

releaseOriginalFigArchive(graph)
const exported = await exportFigFile(graph, undefined, undefined, undefined, false, {
  noImplicitInternalCanvas: true
})
await writeFile(
  output,
  Buffer.from(exported.buffer.slice(exported.byteOffset, exported.byteOffset + exported.byteLength))
)
console.log(`записано: ${output} (${Math.round(exported.byteLength / 1024)} КБ)`)
