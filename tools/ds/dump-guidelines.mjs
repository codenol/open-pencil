// Дамп текстов со страницы Guidelines — основа для правил «можно/нельзя»
import { readFile, writeFile } from 'node:fs/promises'
import { BUILTIN_IO_FORMATS, IORegistry } from '/opt/open-pencil/packages/core/dist/io/index.js'

const io = new IORegistry(BUILTIN_IO_FORMATS)
const { graph } = await io.readDocument({
  name: 'canvas.fig',
  data: new Uint8Array(await readFile('/opt/open-pencil/data/ds-unpacked/canvas.fig'))
})

const lines = []
let textCount = 0

for (const page of graph.getPages(true)) {
  if (page.internalOnly) continue
  if (!/guideline|чек|check|правил|токен/i.test(page.name)) continue
  lines.push(`\n# Страница: ${page.name}`)
  for (const id of page.childIds) walk(id, 0)
}

function walk(id, depth) {
  const node = graph.getNode(id)
  if (!node) return
  if (node.type === 'TEXT') {
    const text = (node.characters ?? '').trim()
    if (text) {
      textCount += 1
      lines.push(`${'  '.repeat(depth)}- ${text.replace(/\n/g, '\n' + '  '.repeat(depth))}`)
    }
  } else if (node.type === 'SECTION' || node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE') {
    const label = node.type === 'SECTION' ? 'SECTION' : node.type === 'FRAME' ? 'FRAME' : node.name.trim()
    if (depth < 4) lines.push(`${'  '.repeat(depth)}[${label}] ${node.name.trim()}`)
  }
  for (const child of node.childIds) walk(child, depth + 1)
}

const out = '/opt/open-pencil/data/ds-guidelines.md'
await writeFile(out, lines.join('\n'))
console.log(`текстов: ${textCount} | записано: ${out}`)
console.log('--- первые 60 строк ---')
console.log(lines.slice(0, 60).join('\n'))
