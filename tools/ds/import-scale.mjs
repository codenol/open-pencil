// Шкала отступов и радиусов — коллекция FLOAT-переменных.
//
// В документе 1792 переменные, и все цветные: отступы, зазоры и радиусы заданы
// числами. Из-за этого правило «отступы токенами» невыполнимо, а правка шкалы
// превращается в ручной проход по мастерам.
//
// Коллекция «Шкала» даёт ступени: 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48 для
// отступов и зазоров и 2, 4, 6, 8, 12, 16, 24 для радиусов. Привязка значений
// к ступеням — отдельный проход: тут только шкала.
//
// Запуск: bun tools/ds/import-scale.mjs <вход.fig> <выход.fig>
import { readFile, writeFile } from 'node:fs/promises'

import * as corePkg from '@open-pencil/core'
import { exportFigFile } from '@open-pencil/core/io'
import { releaseFigPopulationWorker } from '@open-pencil/core/kiwi'
import * as figPkg from '@open-pencil/fig'

const [input, output] = process.argv.slice(2)
if (!input || !output) {
  console.error('нужно: bun tools/ds/import-scale.mjs <вход.fig> <выход.fig>')
  process.exit(1)
}

const SPACE_STEPS = [2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48]
const RADIUS_STEPS = [2, 4, 6, 8, 12, 16, 24]

const bytes = new Uint8Array(await readFile(input))
const parsed = figPkg.parseFigBuffer(bytes.buffer, { skipThumbnail: true })
const graph = corePkg.importNodeChanges(parsed.nodeChanges, parsed.blobs, new Map(parsed.images), {
  populate: 'none'
})

const COLLECTION_ID = 'VariableCollection:scale'
const MODE_ID = 'scale-value'
const existing = graph.variableCollections.get(COLLECTION_ID)
if (!existing) {
  graph.addCollection({
    id: COLLECTION_ID,
    name: 'Шкала',
    modes: [{ modeId: MODE_ID, name: 'Value' }],
    defaultModeId: MODE_ID,
    variableIds: []
  })
}

let added = 0
let skipped = 0
const define = (name, value) => {
  const present = [...graph.variables.values()].some((variable) => variable.name === name)
  if (present) {
    skipped += 1
    return
  }
  graph.addVariable({
    id: `VariableID:scale/${name}`,
    name,
    type: 'FLOAT',
    collectionId: COLLECTION_ID,
    valuesByMode: { [MODE_ID]: value },
    description: '',
    hiddenFromPublishing: false
  })
  added += 1
}

for (const step of SPACE_STEPS) define(`space/${step}`, step)
for (const step of RADIUS_STEPS) define(`radius/${step}`, step)

const collection = graph.variableCollections.get(COLLECTION_ID)
console.log(`шкала: добавлено ${added}, уже было ${skipped}, всего в коллекции ${collection.variableIds.length}`)

releaseFigPopulationWorker(graph)
const exported = await exportFigFile(graph, undefined, undefined, undefined, false, {
  noImplicitInternalCanvas: true
})
await writeFile(
  output,
  Buffer.from(exported.buffer.slice(exported.byteOffset, exported.byteOffset + exported.byteLength))
)
console.log(`записано: ${output} (${Math.round(exported.byteLength / 1024)} КБ)`)
