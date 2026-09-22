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
const only = flags.find((flag) => flag.startsWith('--only='))?.slice('--only='.length)

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

/**
 * Правила для мастера `Table`.
 *
 * Таблица — это НЕ фрейм с ячейками, который рисуют заново. Это готовый
 * компонент: шапка + строки, и его наполняют, а не собирают.
 *
 * Разобрана по факту: `Table` 1615x542, шапка 1615x50, строка 1615x41.
 * Колонки разной ширины: 160, 200, 220, 250. Строка — три слоя: линия
 * разделителя, полоса под ней и содержимое на всю ширину.
 */
const TABLE_RULES = {
  purpose: 'Показывает однотипные записи строками: инстансы, кластеры, узлы, ПАК.',
  use: [
    'Брать готовый компонент Table, а не рисовать таблицу фреймами и прямоугольниками.',
    'Число строк — по числу записей: одна запись одна строка. Пустых строк не оставлять.',
    'Колонки берутся из готового набора ширин: 160, 200, 220, 250. Не задавать ширину на глаз.',
    'Текст ячейки — через текстовый узел внутри ячейки, не через подпись на весь фрейм.',
    'Числа выравниваются по правому краю, текст и названия — по левому.',
    'Одинаковые по смыслу значения пишутся одинаково во всей колонке: «Работает», а не «работает» местами.',
    'Статус в ячейке — готовым бейджем из набора, а не покрашенным текстом.',
    'Сортировку показывает иконка в шапке: sort-amount-up или sort-amount-down. Только на той колонке, по которой сортируют.'
  ],
  avoid: [
    'Не собирать таблицу из прямоугольников, линий и текста вручную.',
    'Не вставлять строку копией фрейма, если есть компонент строки.',
    'Не красить строки зеброй, если макет этого не требует: разделители уже есть.',
    'Не выравнивать колонки пробелами или пустыми фреймами-распорками.'
  ],
  allowed: [
    'Менять текст в ячейках.',
    'Добавлять и удалять строки по числу записей.',
    'Менять ширину колонки на соседнюю из набора ширин.',
    'Ставить иконку сортировки в шапку.',
    'Ставить бейдж статуса в ячейку.',
    'Скрывать колонку, если данных для неё нет во всех записях.'
  ],
  forbidden: [
    'Рисовать таблицу с нуля фреймами, когда есть готовый компонент.',
    'Задавать ширину колонок произвольным числом.',
    'Растягивать таблицу по содержимому: ширина задаётся колонками.',
    'Вставлять текст прямо во фрейм ячейки, минуя текстовый узел.',
    'Оставлять заготовку вида «Column Name» или «VALUE» в готовом макете.',
    'Придумывать колонки, которых нет в данных: пустая колонка хуже её отсутствия.'
  ],
  checks: [
    'Таблица — готовый компонент, а не самодельные фреймы.',
    'Число строк равно числу записей.',
    'Ширины колонок из набора, а не произвольные.',
    'В шапке нет заготовки «Column Name».',
    'Статусы — бейджами из набора.',
    'Иконка сортировки стоит только там, где есть сортировка.'
  ]
}

const RULES_BY_MASTER = {
  icon: ICON_RULES,
  Table: TABLE_RULES
}

const bytes = new Uint8Array(await readFile(input))
const parsed = figPkg.parseFigBuffer(bytes.buffer)
const graph = corePkg.importNodeChanges(parsed.nodeChanges, parsed.blobs, new Map(parsed.images), {
  populate: 'none'
})

let written = 0
for (const [masterName, rules] of Object.entries(RULES_BY_MASTER)) {
  if (only && only !== masterName) continue
  const masters = [...graph.nodes.values()].filter(
    (node) =>
      (node.type === 'COMPONENT_SET' || node.type === 'COMPONENT') &&
      node.name.trim() === masterName
  )
  if (!masters.length) {
    console.error(`мастер "${masterName}" не найден`)
    continue
  }
  for (const master of masters) {
    const entry = {
      pluginId: PLUGIN_ID,
      key: RULES_KEY,
      value: JSON.stringify(rules)
    }
    const rest = master.pluginData.filter(
      (item) => !(item.pluginId === PLUGIN_ID && item.key === RULES_KEY)
    )
    graph.updateNode(master.id, { pluginData: [...rest, entry] })
    console.log(`правила записаны: ${master.id} "${master.name.trim()}"`)
    written += 1
  }
}

if (listOnly) {
  for (const [name, rules] of Object.entries(RULES_BY_MASTER)) {
    console.log(`\n=== ${name} ===`)
    console.log(JSON.stringify(rules, null, 2))
  }
  process.exit(0)
}

if (written === 0) {
  console.error('ничего не записано')
  process.exit(1)
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
