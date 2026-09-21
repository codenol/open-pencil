// Восстанавливает разорванные связи: у инстансов без componentId ищем
// мастер-компонент с тем же именем и прописываем ссылку.
//
// Мастер выбирается по имени инстанса. Если кандидатов несколько — берём
// тот, у которого есть содержимое (childIds.length > 0). Связь с самим собой
// и с пустыми мастерами пропускаем.
//
// Запуск: bun tools/ds/relink-all.mjs <вход> <выход>
import { readFile, writeFile } from 'node:fs/promises'

import * as figPkg from '/opt/open-pencil-clean/packages/fig/dist/index.js'
import * as corePkg from '/opt/open-pencil-clean/packages/core/dist/index.js'
import { exportFigFile } from '/opt/open-pencil-clean/packages/core/dist/io/formats/fig/index.js'
import { populateAndApplyOverrides } from '/opt/open-pencil-clean/packages/fig/dist/instance-overrides.js'
import { releaseOriginalFigArchive } from '/opt/open-pencil-clean/packages/core/dist/kiwi/fig/session/original-archive.js'

const [input, output] = process.argv.slice(2)
if (!input || !output) {
  console.error('нужно: bun tools/ds/relink-all.mjs <вход> <выход>')
  process.exit(1)
}

const bytes = new Uint8Array(await readFile(input))
const parsed = figPkg.parseFigBuffer(bytes.buffer)
const graph = corePkg.importNodeChanges(parsed.nodeChanges, parsed.blobs, new Map(parsed.images), {
  populate: 'none'
})

// Мастера по имени: компоненты и сеты.
const mastersByName = new Map()
for (const node of graph.nodes.values()) {
  if (node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET') continue
  const name = node.name.trim()
  if (!mastersByName.has(name)) mastersByName.set(name, [])
  mastersByName.get(name).push(node)
}

const orphans = [...graph.nodes.values()].filter(
  (node) => node.type === 'INSTANCE' && !node.componentId
)
console.log(`инстансов без ссылки: ${orphans.length}`)

const plan = []
const skipped = new Map()

for (const instance of orphans) {
  const name = instance.name.trim()
  const candidates = (mastersByName.get(name) ?? []).filter(
    (candidate) => candidate.id !== instance.id && candidate.childIds.length > 0
  )
  // Предпочитаем вариант из сета — у него осмысленное содержимое.
  const master =
    candidates.find((candidate) => graph.getNode(candidate.parentId)?.type === 'COMPONENT_SET') ??
    candidates[0] ??
    null
  if (!master) {
    skipped.set(name, (skipped.get(name) ?? 0) + 1)
    continue
  }
  plan.push({ instance, master })
}

console.log(`к связке: ${plan.length} | без мастера: ${[...skipped.values()].reduce((a, b) => a + b, 0)}`)

for (const item of plan) {
  graph.updateNode(item.instance.id, { componentId: item.master.id })
}

populateAndApplyOverrides(
  graph,
  new Map(),
  new Map(plan.map((item) => [item.instance.id, item.instance.id]))
)

let filled = 0
for (const item of plan) {
  if ((graph.getNode(item.instance.id)?.childIds.length ?? 0) > 0) filled += 1
}
console.log(`наполнено: ${filled} из ${plan.length}`)

if (skipped.size) {
  console.log('\nбез мастера в файле (топ-20):')
  for (const [name, count] of [...skipped.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    console.log(`  ${String(count).padStart(4)}  ${name}`)
  }
}

releaseOriginalFigArchive(graph)
const exported = await exportFigFile(graph, undefined, undefined, undefined, false, {
  noImplicitInternalCanvas: true
})
await writeFile(
  output,
  Buffer.from(exported.buffer.slice(exported.byteOffset, exported.byteOffset + exported.byteLength))
)
console.log(`\nзаписано: ${output} (${Math.round(exported.byteLength / 1024)} КБ)`)
