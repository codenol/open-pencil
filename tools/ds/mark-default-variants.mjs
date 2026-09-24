// Помечает базовый вариант у сетоов дизайн-системы.
//
// У сета вариантов нет «варианта по умолчанию», поэтому при вставке выбирался
// случайный. Здесь помечаем осмысленный: Default, обычный размер, основной
// Sentiment. Панель ассетов и ассистент берут этот вариант.
//
// Запуск: bun tools/ds/mark-default-variants.mjs <вход.fig> <выход.fig> [--list]
import { readFile, writeFile } from 'node:fs/promises'

import * as corePkg from '@open-pencil/core'
import { exportFigFile } from '@open-pencil/core/io'
import { markDefaultVariant, releaseOriginalFigArchive } from '@open-pencil/core/tools'
import * as figPkg from '@open-pencil/fig'

const [input, output, ...flags] = process.argv.slice(2)
const listOnly = flags.includes('--list')

/**
 * Как выбирать базовый вариант: по убыванию предпочтения.
 * Первый подошедший шаблон выигрывает.
 */
const PREFERENCE = [
  // Ячейка таблицы: обычная текстовая ячейка, а не служебная с чекбоксом.
  /^content=text, type cell=default$/i,
  /^content=text \+ badge, type cell=default$/i,
  // Шапка таблицы: колонка с фильтром по тексту.
  /^property 1=text-filter$/i,
  // Обычное состояние, никаких hover/disabled.
  /^state=default(,|$)/i,
  /^property 1=default$/i,
  // Основной вид: заливка, обычный размер.
  /state=default.*type=filled.*size=large.*sentiment=accent/i,
  /state=default.*size=16.*sentiment=accent/i,
  /^default$/i,
  // Просто обычное состояние без уточнений.
  /state=default/i,
  /^size=16$/i,
  /^property 1=(default|collapsed|text)$/i,
  /^(state=)?hover/i
]

/** Совсем не подходят: сломанные и неосновные состояния. */
const EXCLUDE = [/disabled/i, /unavailable/i, /critical/i, /warning/i, /danger/i]

function pickDefault(variants) {
  for (const pattern of EXCLUDE) {
    if (variants.every((v) => pattern.test(v.name))) return variants[0]
  }
  for (const pattern of PREFERENCE) {
    const match = variants.find((v) => pattern.test(v.name.trim()) && !EXCLUDE.some((e) => e.test(v.name)))
    if (match) return match
  }
  return variants[0]
}

const bytes = new Uint8Array(await readFile(input))
const parsed = figPkg.parseFigBuffer(bytes.buffer)
const graph = corePkg.importNodeChanges(parsed.nodeChanges, parsed.blobs, new Map(parsed.images), {
  populate: 'none'
})

const sets = [...graph.nodes.values()].filter(
  (node) => node.type === 'COMPONENT_SET' && node.childIds.length > 0
)
console.log(`сетоов: ${sets.length}`)

let marked = 0
const report = []
for (const set of sets) {
  const variants = set.childIds.map((id) => graph.getNode(id)).filter(Boolean)
  if (!variants.length) continue
  const chosen = pickDefault(variants)
  if (!chosen) continue
  if (markDefaultVariant(graph, set.id, chosen.id)) {
    marked += 1
    report.push(`${set.name.trim()} → ${chosen.name.trim()} (из ${variants.length})`)
  }
}

console.log(`помечено базовых: ${marked}`)
console.log('\nпримеры:')
for (const line of report.slice(0, 20)) console.log(`  ${line}`)

if (listOnly) process.exit(0)

releaseOriginalFigArchive(graph)
const exported = await exportFigFile(graph, undefined, undefined, undefined, false, {
  noImplicitInternalCanvas: true
})
await writeFile(
  output,
  Buffer.from(exported.buffer.slice(exported.byteOffset, exported.byteOffset + exported.byteLength))
)
console.log(`\nзаписано: ${output} (${Math.round(exported.byteLength / 1024)} КБ)`)
