// Правила компонента: когда брать, что можно менять, что нельзя.
//
// Хранятся в pluginData компонента — рядом с самим компонентом, поэтому едут
// вместе с ним в файле и в библиотеке. Формат один на все компоненты, чтобы
// вкладка «Правила» показывала их единообразно.
//
// Запуск: bun tools/ds/component-rules.mjs <вход.fig> <выход.fig> [--list]
import { readFile, writeFile } from 'node:fs/promises'

import * as figPkg from '/opt/open-pencil-clean/packages/fig/dist/index.js'
import * as corePkg from '/opt/open-pencil-clean/packages/core/dist/index.js'
import { exportFigFile } from '/opt/open-pencil-clean/packages/core/dist/io/formats/fig/index.js'
import { releaseOriginalFigArchive } from '/opt/open-pencil-clean/packages/core/dist/kiwi/fig/session/original-archive.js'

const [input, output, ...flags] = process.argv.slice(2)
const listOnly = flags.includes('--list')

const PLUGIN_ID = 'norka.design-system'
const RULES_KEY = 'component-rules'

/**
 * Правила для мастера `icon`.
 *
 * Ключевое: иконка не существует сама по себе. Даже крестик закрытия —
 * это button-icon-action, а не отдельная иконка.
 */
const ICON_RULES = {
  purpose: 'Уточняет смысл: состояние, действие, категория.',
  use: [
    'Только в составе чего-то: кнопка, пункт меню, поле, бейдж, строка списка.',
    'Даже крестик закрытия — это button-icon-action, а не отдельная иконка.',
    'Одинокая иконка допустима только внутри готового компонента, где смысл однозначен по контексту.',
    'Размер берётся из контекста: в кнопке — 16, в кнопке-действии — 12, в крупном элементе — 20 или 24.',
    'Смысл сверяется со словарём: избранное → heart, корзина → cart, поиск → search.'
  ],
  avoid: [
    'Не брать иконку саму по себе — ни в макете, ни в сборке.',
    'Не подставлять иконку для украшения, без смысла.',
    'Не выдумывать новый значок, если в наборе есть подходящий по смыслу.'
  ],
  allowed: [
    'Заменить саму иконку свапом на нужный компонент из набора.',
    'Выбрать другой размерный вариант.',
    'Задать цвет токеном из системы.'
  ],
  forbidden: [
    'Растягивать непропорционально — только размерные варианты.',
    'Поворачивать, кроме случаев, где поворот и есть смысл: стрелка раскрытия, шеврон.',
    'Красить произвольным цветом. Нужен новый оттенок — сначала добавить токен.',
    'Оставлять подстановочный маркер. Если видно wine — свап не сделан, задача не закрыта.',
    'Вставлять иконку картинкой или отдельным вектором мимо компонента.'
  ],
  checks: [
    'В макете не осталось подстановочного маркера.',
    'Иконка внутри компонента, а не сама по себе.',
    'Размер совпадает с контекстом.',
    'Цвет взят токеном, а не задан напрямую.'
  ]
}

const bytes = new Uint8Array(await readFile(input))
const parsed = figPkg.parseFigBuffer(bytes.buffer)
const graph = corePkg.importNodeChanges(parsed.nodeChanges, parsed.blobs, new Map(parsed.images), {
  populate: 'none'
})

const masters = [...graph.nodes.values()].filter(
  (node) => node.type === 'COMPONENT_SET' && node.name.trim() === 'icon'
)
if (!masters.length) {
  console.error('мастер-сет "icon" не найден')
  process.exit(1)
}

for (const master of masters) {
  const entry = {
    pluginId: PLUGIN_ID,
    key: RULES_KEY,
    value: JSON.stringify(ICON_RULES)
  }
  const rest = master.pluginData.filter(
    (item) => !(item.pluginId === PLUGIN_ID && item.key === RULES_KEY)
  )
  graph.updateNode(master.id, { pluginData: [...rest, entry] })
  console.log(`правила записаны: ${master.id} "${master.name.trim()}"`)
}

if (listOnly) {
  console.log(JSON.stringify(ICON_RULES, null, 2))
  process.exit(0)
}

releaseOriginalFigArchive(graph)
const exported = await exportFigFile(graph, undefined, undefined, undefined, false, {
  noImplicitInternalCanvas: true
})
await writeFile(
  output,
  Buffer.from(exported.buffer.slice(exported.byteOffset, exported.byteOffset + exported.byteLength))
)
console.log(`записано: ${output} (${Math.round(exported.byteLength / 1024)} КБ)`)
