// Ширина ячейки таблицы: в колонке она растягивается, а не стоит фиксированной.
//
// Разобрано по факту: у ячеек шапки и строк внутреннее растягивание настроено
// (текст и вложенные фреймы тянутся по родителю), а сама ячейка имеет
// фиксированную ширину — 200, 297, 262, 86. Поэтому при вставке в колонку
// ячейка не занимает её целиком: ширины шапки и строк не сходятся, и собрать
// таблицу из готовых клеток нельзя.
//
// В таблице ширину задаёт КОЛОНКА, а ячейка тянется по ней. Высоту не трогаем:
// высота ряда задана размером ячейки и менять её не нужно.
//
// Запуск: bun tools/ds/table-cell-width.mjs <вход.fig> <выход.fig> [--check]
import { readFile, writeFile } from 'node:fs/promises'

import * as figPkg from '/opt/open-pencil-clean/packages/fig/dist/index.js'
import * as corePkg from '/opt/open-pencil-clean/packages/core/dist/index.js'
import { exportFigFile } from '/opt/open-pencil-clean/packages/core/dist/io/formats/fig/index.js'
import { releaseFigPopulationWorker } from '/opt/open-pencil-clean/packages/core/dist/kiwi/fig/population/client.js'

const [input, output, ...flags] = process.argv.slice(2)
const checkOnly = flags.includes('--check')

/** Наборы ячеек: в них ширина должна тянуться по колонке. */
const CELL_SETS = ['table cell', 'table header cell']

const bytes = new Uint8Array(await readFile(input))
const parsed = figPkg.parseFigBuffer(bytes.buffer)
const graph = corePkg.importNodeChanges(parsed.nodeChanges, parsed.blobs, new Map(parsed.images), {
  populate: 'none'
})

let changed = 0
let checked = 0

for (const setName of CELL_SETS) {
  const set = [...graph.nodes.values()].find(
    (node) => node.type === 'COMPONENT_SET' && node.name.trim() === setName
  )
  if (!set) {
    console.error(`набор "${setName}" не найден`)
    continue
  }

  for (const variantId of set.childIds) {
    const variant = graph.getNode(variantId)
    if (!variant) continue
    checked += 1

    // Раскладка в ряд: ширина по главной оси, потому что родитель — колонка.
    const widthField = variant.layoutMode === 'VERTICAL' ? 'counterAxisSizing' : 'primaryAxisSizing'
    const needsStretch =
      variant.layoutAlignSelf !== 'STRETCH' ||
      variant.width === undefined ||
      variant[widthField] === 'FIXED'

    if (!needsStretch) continue

    if (checkOnly) {
      console.log(
        `нужна правка: "${variant.name.trim().slice(0, 44)}" ` +
          `ширина=${Math.round(variant.width)} ${widthField}=${variant[widthField]} ` +
          `alignSelf=${variant.layoutAlignSelf ?? '—'}`
      )
      continue
    }

    // Ширину фиксируем как есть, но даём растягиваться в родителе: колонка
    // задаёт ширину сама, а ячейка её занимает.
    graph.updateNode(variantId, {
      layoutAlignSelf: 'STRETCH',
      [widthField]: 'FIXED',
      minWidth: null,
      maxWidth: null
    })
    changed += 1
    console.log(
      `растягивание задано: "${variant.name.trim().slice(0, 44)}" ` +
        `было ${Math.round(variant.width)}`
    )
  }
}

console.log(`проверено ячеек: ${checked}`)

if (checkOnly) process.exit(0)
if (changed === 0) {
  console.log('нечего менять')
  process.exit(0)
}

// Снимаем кэш исходного архива: иначе экспорт вернёт файл как есть, и правки
// не доедут. Одного освобождения архива мало — он запрашивается заново из
// воркера, который считает себя валидным, пока не тронута структура.
releaseFigPopulationWorker(graph)
const exported = await exportFigFile(graph, undefined, undefined, undefined, false, {
  noImplicitInternalCanvas: true
})
await writeFile(
  output,
  Buffer.from(exported.buffer.slice(exported.byteOffset, exported.byteOffset + exported.byteLength))
)
console.log(`записано: ${output} (${Math.round(exported.byteLength / 1024)} КБ, правок ${changed})`)
