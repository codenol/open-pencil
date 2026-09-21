// Связывает пустые инстансы иконок с вариантом Size=16 сета `icon`.
//
// В файле 1 075 инстансов без ссылки на мастер. Часть из них — иконки:
// они лежат там же, где уже связанные иконки (в тех же родителях).
// Их определяем по окружению, а не по имени: имена у иконок разные
// (`endContent`, `button-icon-action`, `u:sort-amount-down`).
//
// Внутри сета `icon` лежит инстанс `wine` — он служит маркером: дизайнер
// потом пройдётся Swap'ом и заменит wine на нужную иконку.
//
// Запуск: bun tools/ds/link-all-icons.mjs <вход> <выход> [размер]
import { readFile, writeFile } from 'node:fs/promises'

import * as figPkg from '/opt/open-pencil-clean/packages/fig/dist/index.js'
import * as corePkg from '/opt/open-pencil-clean/packages/core/dist/index.js'
import { exportFigFile } from '/opt/open-pencil-clean/packages/core/dist/io/formats/fig/index.js'
import { populateAndApplyOverrides } from '/opt/open-pencil-clean/packages/fig/dist/instance-overrides.js'
import { releaseOriginalFigArchive } from '/opt/open-pencil-clean/packages/core/dist/kiwi/fig/session/original-archive.js'

const [input, output, size = '16'] = process.argv.slice(2)
if (!input || !output) {
  console.error('нужно: bun tools/ds/link-all-icons.mjs <вход> <выход> [размер]')
  process.exit(1)
}

const bytes = new Uint8Array(await readFile(input))
const parsed = figPkg.parseFigBuffer(bytes.buffer)
const graph = corePkg.importNodeChanges(parsed.nodeChanges, parsed.blobs, new Map(parsed.images), {
  populate: 'none'
})

// Мастер — вариант сета `icon` заданного размера.
const iconSet = [...graph.nodes.values()].find(
  (node) => node.type === 'COMPONENT_SET' && node.name.trim() === 'icon'
)
if (!iconSet) {
  console.error('сет "icon" не найден')
  process.exit(1)
}
const master =
  iconSet.childIds
    .map((id) => graph.getNode(id))
    .find((variant) => variant?.name.trim() === `Size=${size}`) ?? null
if (!master) {
  console.error(`вариант Size=${size} не найден`)
  process.exit(1)
}

/**
 * Иконка — это пустой инстанс, лежащий в контейнере, где уже есть связанная
 * иконка. Имена у иконок произвольные, поэтому ориентируемся на окружение.
 */
const linkedIconParents = new Set(
  [...graph.nodes.values()]
    .filter((node) => node.type === 'INSTANCE' && node.componentId === master.id)
    .map((node) => node.parentId)
)

// Исключаем инстансы, у которых есть собственный компонент или сет с тем же
// именем: `Checkbox`, `button`, `endContent` лежат рядом с иконками, но это
// не иконки — их связывают со своими мастерами.
const componentNames = new Set(
  [...graph.nodes.values()]
    .filter((node) => node.type === 'COMPONENT' || node.type === 'COMPONENT_SET')
    .map((node) => node.name.trim())
)

const orphans = [...graph.nodes.values()].filter(
  (node) =>
    node.type === 'INSTANCE' &&
    !node.componentId &&
    linkedIconParents.has(node.parentId) &&
    node.id !== master.id &&
    !componentNames.has(node.name.trim())
)

console.log(`мастер: ${master.id} "${master.name}" (${Math.round(master.width)}x${Math.round(master.height)})`)
console.log(`контейнеров с иконками: ${linkedIconParents.size}`)
console.log(`иконок к связке: ${orphans.length}`)

const byName = new Map()
for (const instance of orphans) {
  const key = instance.name.trim()
  byName.set(key, (byName.get(key) ?? 0) + 1)
  graph.updateNode(instance.id, { componentId: master.id })
}
for (const [name, count] of [...byName.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(4)}  ${name}`)
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
console.log(`\nнаполнено: ${filled} из ${orphans.length}`)

releaseOriginalFigArchive(graph)
const exported = await exportFigFile(graph, undefined, undefined, undefined, false, {
  noImplicitInternalCanvas: true
})
await writeFile(
  output,
  Buffer.from(exported.buffer.slice(exported.byteOffset, exported.byteOffset + exported.byteLength))
)
console.log(`записано: ${output} (${Math.round(exported.byteLength / 1024)} КБ)`)
