// Создаёт файл-каркас дизайн-системы: страницы по именам компонентов (без эмодзи).
// Дизайнер открывает его в редакторе и вставляет на каждую страницу содержимое
// компонента из Figma — дальше система связывает это с токенами и библиотекой.
import { readFile, writeFile } from 'node:fs/promises'

import * as figPkg from '/opt/open-pencil/packages/fig/dist/index.js'
import * as corePkg from '/opt/open-pencil/packages/core/dist/index.js'
import { exportFigFile } from '/opt/open-pencil/packages/core/dist/io/formats/fig/index.js'
import { SceneGraph } from '/opt/open-pencil/packages/scene-graph/dist/index.js'

const SOURCE = '/tmp/ds-nofigma.fig'
const OUT = '/opt/open-pencil/data/ds-skeleton.fig'

// Страницы-разделители и служебные пропускаем: они не про компоненты.
const SKIP = [
  'draft',
  'Page',
  'Plugin',
  'Research',
  'аналитика',
  '---',
  'Cover',
  'Guidelines',
  'Internal',
  'Tests component',
  'Components',
  'Typography',
  'Dimensions',
  'Gaps',
  'Data table'
]
// Эмодзи и пометки Figma из имён убираем — так список читается и ищется.
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2190}-\u{2BFF}\u{FE0F}\u{200D}]/gu

function cleanName(name) {
  return name
    .replace(EMOJI, '')
    .replace(/\(без описания\)/gi, '')
    .replace(/\(o_o\)|\(_\)/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

const bytes = new Uint8Array(await readFile(SOURCE))
const parsed = figPkg.parseFigBuffer(bytes.buffer)
const source = corePkg.importNodeChanges(parsed.nodeChanges, parsed.blobs, new Map(parsed.images), {
  populate: 'none'
})

const skeleton = new SceneGraph()
// Стартовую страницу переименовываем в первую из списка.
const first = skeleton.getPages()[0]

const names = []
for (const page of source.getPages(true)) {
  if (page.internalOnly) continue
  const name = cleanName(page.name)
  if (!name) continue
  if (SKIP.some((skip) => name.toLowerCase().startsWith(skip.toLowerCase()))) continue
  if (names.includes(name)) continue
  names.push(name)
}

names.sort((a, b) => a.localeCompare(b, 'ru'))

first.name = names[0]
for (const name of names.slice(1)) {
  const page = skeleton.createNode('CANVAS', skeleton.rootId, { name, width: 0, height: 0 })
  void page
}

console.log(`страниц создано: ${names.length}`)
for (const name of names) console.log(`  ${name}`)

const out = await exportFigFile(skeleton, undefined, undefined, first.id, false, {
  noImplicitInternalCanvas: true
})
await writeFile(OUT, out)
console.log(`\nфайл: ${OUT} (${Math.round(out.byteLength / 1024)} КБ)`)
