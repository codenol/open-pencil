// Связывает инстансы иконки с её мастером-компонентом.
//
// На странице Icon лежит компонент `wine` (настоящий вектор) и сет `icon`
// с вариантами Size=10/12/16/20/24. Внутри каждого варианта — инстанс `wine`,
// но без ссылки на мастер: componentId пустой, содержимого нет. Поэтому иконки
// в компонентах не отрисовываются.
//
// Скрипт ставит инстансам componentId мастера и наполняет их содержимым.
//
// Запуск: bun tools/ds/link-icons.mjs <входной canvas.fig> <выходной canvas.fig> [имя_мастера]
import { readFile, writeFile } from 'node:fs/promises'

import * as figPkg from '/opt/open-pencil-clean/packages/fig/dist/index.js'
import * as corePkg from '/opt/open-pencil-clean/packages/core/dist/index.js'
import { exportFigFile } from '/opt/open-pencil-clean/packages/core/dist/io/formats/fig/index.js'
import { populateAndApplyOverrides } from '/opt/open-pencil-clean/packages/fig/dist/instance-overrides.js'
import { releaseOriginalFigArchive } from '/opt/open-pencil-clean/packages/core/dist/kiwi/fig/session/original-archive.js'

const [input, output, masterName = 'wine'] = process.argv.slice(2)
if (!input || !output) {
  console.error('нужно: bun tools/ds/link-icons.mjs <вход> <выход> [имя мастера]')
  process.exit(1)
}

const bytes = new Uint8Array(await readFile(input))
const parsed = figPkg.parseFigBuffer(bytes.buffer)
const graph = corePkg.importNodeChanges(parsed.nodeChanges, parsed.blobs, new Map(parsed.images), {
  populate: 'none'
})

// Мастер — компонент с этим именем (первый найденный).
const master = [...graph.nodes.values()].find(
  (node) => node.type === 'COMPONENT' && node.name.trim() === masterName
)
if (!master) {
  console.error(`мастер "${masterName}" не найден`)
  process.exit(1)
}

// Инстансы с этим именем, у которых нет ссылки на мастер.
const orphans = [...graph.nodes.values()].filter(
  (node) => node.type === 'INSTANCE' && node.name.trim() === masterName && !node.componentId
)

console.log(`мастер: ${master.id} (${Math.round(master.width)}x${Math.round(master.height)})`)
console.log(`сирот к связке: ${orphans.length}`)

// Шаг 1: только ссылка на мастер. Наполнение делает populateInstances —
// он же проставляет связку родитель→клон, без которой дети не переживают экспорт.
for (const instance of orphans) {
  graph.updateNode(instance.id, { componentId: master.id })
}

// Шаг 2: наполняем инстансы так же, как это делает импорт Figma.
populateAndApplyOverrides(
  graph,
  new Map(),
  new Map(orphans.map((instance) => [instance.id, instance.id]))
)

let linked = 0
for (const instance of orphans) {
  const after = graph.getNode(instance.id)
  const children = after?.childIds.length ?? 0
  console.log(`  ${instance.id} (parent: ${graph.getNode(instance.parentId)?.name?.trim() ?? '?'}) → детей ${children}`)
  if (children > 0) linked += 1
}

// Экспорт по умолчанию возвращает исходный архив целиком (originalFigArchive),
// игнорируя правки графа. Отключаем архив, чтобы файл собрался из наших данных.
releaseOriginalFigArchive(graph)

// exportFigFile уже отдаёт готовый контейнер (.fig = zip с canvas.fig внутри),
// поэтому пишем его как есть — упаковывать повторно нельзя.
const exported = await exportFigFile(graph, undefined, undefined, undefined, false, {
  noImplicitInternalCanvas: true
})
await writeFile(output, Buffer.from(exported.buffer.slice(exported.byteOffset, exported.byteOffset + exported.byteLength)))

console.log(`\nсвязано: ${linked} из ${orphans.length}`)
console.log(`записано: ${output} (${Math.round(exported.byteLength / 1024)} КБ)`)
