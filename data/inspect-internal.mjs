// Что на служебной странице "Internal Only Canvas" и что на рабочих страницах DS-файла
import { readFile } from 'node:fs/promises'
import { BUILTIN_IO_FORMATS, IORegistry } from '/opt/open-pencil/packages/core/dist/io/index.js'

const io = new IORegistry(BUILTIN_IO_FORMATS)
const { graph } = await io.readDocument({
  name: 'canvas.fig',
  data: new Uint8Array(await readFile('/opt/open-pencil/data/ds-unpacked/canvas.fig'))
})

const internalPage = graph.getPages(true).find((p) => p.internalOnly)
console.log('служебная страница:', internalPage?.name, '| верхних нод:', internalPage?.childIds.length)

// компоненты на служебной странице: типы и примеры имён
function collectComponents(rootIds) {
  const found = []
  const visited = new Set()
  const pending = [...rootIds]
  while (pending.length > 0) {
    const id = pending.pop()
    if (!id || visited.has(id)) continue
    visited.add(id)
    const node = graph.getNode(id)
    if (!node) continue
    if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') found.push(node)
    pending.push(...node.childIds)
  }
  return found
}

const internalComponents = collectComponents(internalPage?.childIds ?? [])
console.log('компонентов на служебной:', internalComponents.length)

const sets = internalComponents.filter((c) => c.type === 'COMPONENT_SET')
console.log('из них сетов:', sets.length, '| отдельных компонентов:', internalComponents.length - sets.length)

// частота семейств имён
const families = new Map()
for (const node of internalComponents) {
  const base = (node.parentId ? graph.getNode(node.parentId)?.name : null) ?? node.name
  const family = /^(fi:|u:)/.test(node.name) ? node.name.split(':')[0] + ':*' : node.name.replace(/=.*/, '').trim()
  families.set(family, (families.get(family) ?? 0) + 1)
}
const top = [...families.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
console.log('топ имён на служебной:')
for (const [name, count] of top) console.log(`  ${String(count).padStart(6)}  ${name}`)

// примеры: есть ли кнопки?
const buttons = internalComponents.filter((c) => /button/i.test(c.name)).slice(0, 12)
console.log('примеры с button:', buttons.map((c) => `${c.type}:${c.name}`).join(' | '))

// рабочие страницы: сколько компонентов и примеры имён сетов
console.log('\n=== рабочие страницы ===')
for (const page of graph.getPages(true)) {
  if (page.internalOnly) continue
  const comps = collectComponents(page.childIds)
  if (comps.length === 0) continue
  const pageSets = comps.filter((c) => c.type === 'COMPONENT_SET')
  console.log(`${page.name.slice(0, 40).padEnd(40)} компонентов ${comps.length}, сетов ${pageSets.length}`)
}
