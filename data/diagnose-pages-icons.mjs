// Обзор: страницы файла и количество компонентов на каждой (без populate)
import { readFile } from 'node:fs/promises'

const io = await import('/opt/open-pencil/packages/core/dist/io/index.js')

const bytes = new Uint8Array(await readFile('/opt/open-pencil/data/icons-unpacked/canvas.fig'))
const registry = new io.IORegistry(io.BUILTIN_IO_FORMATS)
const { graph } = await registry.readDocument({ name: 'icons.fig', data: bytes })

const pages = graph.getPages().map((page) => {
  let components = 0
  let componentSets = 0
  let frames = 0
  let total = 0
  const walk = (id) => {
    const node = graph.getNode(id)
    if (!node) return
    total += 1
    if (node.type === 'COMPONENT') components += 1
    else if (node.type === 'COMPONENT_SET') componentSets += 1
    else if (node.type === 'FRAME') frames += 1
    for (const childId of node.childIds) walk(childId)
  }
  for (const childId of page.childIds) walk(childId)
  return { name: page.name, id: page.id, components, componentSets, frames, total }
})

console.log(JSON.stringify({ pageCount: pages.length, pages }, null, 2))
