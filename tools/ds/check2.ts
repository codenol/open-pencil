import { readFileSync } from 'node:fs'
import { parseFigFile } from '@open-pencil/core'
const FIG = '/Users/a1111/Documents/Kimi/Workspaces/Openorka/storage-root/files/ds-main.fig'
const bytes = readFileSync(FIG)
const graph = await parseFigFile(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
const master = graph.getNode('1:96')
const owner = graph.getNode('1:90')
const top = graph.getNode('1:99')
const copy = graph.getNode('1:8000000796')
const junk = ['1:101','0:3943'].map(id => { const n = graph.getNode(id); return n ? `${id} ${n.type} "${n.name}"` : `${id} MISSING` })
console.log(JSON.stringify({
  masterRefs: master?.componentPropertyReferences,
  ownerDefs: owner?.componentPropertyDefinitions,
  assignment99: top?.componentPropertyAssignments,
  copyChildren: copy?.childIds,
  junk
}, null, 1))
