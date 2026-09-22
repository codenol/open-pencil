// Разводим два компонента с одинаковым именем `status`.
//
// В дизайн-системе их два, и они разные:
//   стр. Sidebar — 3 варианта, кружки 40x40: default, Danger, lock
//   стр. Status  — 70 вариантов, бейджи 57x24 и 51x17: Severity + Content
//
// Ассистент просит `status` и получает первый попавшийся — не тот, что нужен.
// Различала их только галочка в имени, что ненадёжно.
//
// Бейджи статусов оставляем как `status`: их больше и они используются в
// таблицах. Кружки со Sidebar называем `status-dot` — по форме и назначению.
//
// Запуск: bun tools/ds/rename-status-dot.mjs <вход.fig> <выход.fig> [--check]
import { readFile, writeFile } from 'node:fs/promises'

import * as figPkg from '/opt/open-pencil-clean/packages/fig/dist/index.js'
import * as corePkg from '/opt/open-pencil-clean/packages/core/dist/index.js'
import { exportFigFile } from '/opt/open-pencil-clean/packages/core/dist/io/formats/fig/index.js'
import { releaseFigPopulationWorker } from '/opt/open-pencil-clean/packages/core/dist/kiwi/fig/population/client.js'

const [input, output, ...flags] = process.argv.slice(2)
const checkOnly = flags.includes('--check')

/** Страница, на которой лежит сет-кружок. */
const DOT_PAGE = 'Sidebar'
const OLD_NAME = 'status'
const NEW_NAME = 'status-dot'

const bytes = new Uint8Array(await readFile(input))
const parsed = figPkg.parseFigBuffer(bytes.buffer)
const graph = corePkg.importNodeChanges(parsed.nodeChanges, parsed.blobs, new Map(parsed.images), {
  populate: 'none'
})

/** Ближайшая страница узла. */
function pageOf(node) {
  let current = node
  while (current?.parentId) {
    current = graph.getNode(current.parentId)
    if (current?.type === 'CANVAS') return current.name
  }
  return ''
}

const target = [...graph.nodes.values()].find(
  (node) =>
    node.type === 'COMPONENT_SET' &&
    /^✅?status$/i.test(node.name.trim()) &&
    pageOf(node) === DOT_PAGE
)

if (!target) {
  console.error(`сет "${OLD_NAME}" на странице ${DOT_PAGE} не найден`)
  process.exit(1)
}

console.log(
  `найден: ${target.id} "${target.name.trim()}" ` +
    `вариантов=${target.childIds.length} страница=${pageOf(target)}`
)

if (checkOnly) process.exit(0)

graph.updateNode(target.id, { name: NEW_NAME })

const check = graph.getNode(target.id)
console.log(`переименован: "${OLD_NAME}" → "${check?.name}"`)

releaseFigPopulationWorker(graph)
const exported = await exportFigFile(graph, undefined, undefined, undefined, false, {
  noImplicitInternalCanvas: true
})
await writeFile(
  output,
  Buffer.from(exported.buffer.slice(exported.byteOffset, exported.byteOffset + exported.byteLength))
)
console.log(`записано: ${output} (${Math.round(exported.byteLength / 1024)} КБ)`)
