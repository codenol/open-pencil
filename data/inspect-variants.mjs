// Варианты кнопок в DS vs структура токенов
import { readFile } from 'node:fs/promises'
import { BUILTIN_IO_FORMATS, IORegistry } from '/opt/open-pencil/packages/core/dist/io/index.js'

const io = new IORegistry(BUILTIN_IO_FORMATS)
const { graph } = await io.readDocument({
  name: 'canvas.fig',
  data: new Uint8Array(await readFile('/opt/open-pencil/data/ds-unpacked/canvas.fig'))
})

const pages = graph.getPages(true)
const pageOf = (nodeId) => {
  const pageIds = new Set(pages.map((p) => p.id))
  let current = graph.getNode(nodeId)
  while (current) {
    if (pageIds.has(current.id)) return current
    current = current.parentId ? graph.getNode(current.parentId) : undefined
  }
  return undefined
}

// ищем сет «button» на рабочей странице
const sets = []
for (const [, node] of graph.nodes) {
  if (node.type === 'COMPONENT_SET') sets.push(node)
}
const workingButton = sets.find((s) => s.name.trim() === 'button' && !pageOf(s.id)?.internalOnly)
if (!workingButton) {
  console.log('рабочий сет button не найден; списки сетов:')
  for (const s of sets.slice(0, 20)) console.log(' ', s.name, pageOf(s.id)?.name)
} else {
  console.log('сет:', workingButton.name, '| страница:', pageOf(workingButton.id)?.name, '| вариантов:', workingButton.childIds.length)
  console.log('свойства сета (componentPropertyDefinitions):')
  const defs = workingButton.componentPropertyDefinitions ?? {}
  console.log(JSON.stringify(defs, null, 1).slice(0, 1200))
  console.log('\nвариантов (первые 25):')
  const variants = workingButton.childIds.map((id) => graph.getNode(id)).filter(Boolean)
  for (const variant of variants.slice(0, 25)) {
    console.log('  ', variant.name)
  }
  if (variants.length > 25) console.log(`   ... всего ${variants.length}`)
  // уникальные значения каждого свойства
  const propValues = new Map()
  for (const variant of variants) {
    for (const part of variant.name.split(',')) {
      const [key, value] = part.split('=').map((s) => s.trim())
      if (!key || !value) continue
      if (!propValues.has(key)) propValues.set(key, new Set())
      propValues.get(key).add(value)
    }
  }
  console.log('\nсвойства вариантов:')
  for (const [key, values] of propValues) console.log(`  ${key}: ${[...values].join(', ')}`)
}
