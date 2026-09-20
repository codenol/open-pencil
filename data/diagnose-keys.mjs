// Диагностика: какие компоненты в canvas.fig не имеют стабильного librарного ключа
import { readFile, writeFile } from 'node:fs/promises'

const io = await import('/opt/open-pencil/packages/core/dist/io/index.js')

const bytes = new Uint8Array(await readFile('/opt/open-pencil/data/ds-unpacked/canvas.fig'))
const registry = new io.IORegistry(io.BUILTIN_IO_FORMATS)
const { graph } = await registry.readDocument({ name: 'canvas.fig', data: bytes })

const components = []
for (const node of graph.getAllNodes()) {
  if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
    components.push({
      id: node.id,
      name: node.name,
      type: node.type,
      componentKey: node.componentKey ?? null,
      sourceLibraryKey: node.sourceLibraryKey ?? null,
      publishId: node.publishId ?? null,
      sourceId: node.source?.id ?? null,
      parentId: node.parentId ?? null
    })
  }
}

const missing = components.filter(
  (c) => !c.componentKey && !c.sourceLibraryKey && !c.publishId && !c.sourceId
)

console.log(JSON.stringify({
  total: components.length,
  missingCount: missing.length,
  missing: missing.slice(0, 40),
  sampleWithKeys: components.filter((c) => c.componentKey).slice(0, 3)
}, null, 2))
