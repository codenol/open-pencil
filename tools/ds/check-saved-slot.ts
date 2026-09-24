import { readFileSync } from 'node:fs'

import { parseFigFile } from '@open-pencil/core'

const FIG = '/Users/a1111/Documents/Kimi/Workspaces/Openorka/storage-root/files/ds-main.fig'
const bytes = readFileSync(FIG)
const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
const graph = await parseFigFile(ab)

function brief(id: string) {
  const n = graph.getNode(id)
  if (!n) return { id, missing: true }
  return {
    id: n.id,
    name: n.name,
    type: n.type,
    componentId: n.componentId,
    componentPropertyReferences: n.componentPropertyReferences,
    componentPropertyAssignments: n.componentPropertyAssignments,
    fills: n.fills?.map((f) => (f.type === 'SOLID' ? `rgb(${Math.round(f.color.r * 255)},${Math.round(f.color.g * 255)},${Math.round(f.color.b * 255)}) op=${f.opacity}` : f.type)),
    children: n.childIds.map((cid) => {
      const c = graph.getNode(cid)
      return c ? `${cid} ${c.type} "${c.name}" comp=${c.componentId ?? '-'}` : `${cid} MISSING`
    })
  }
}

console.log('== master slot 1:96 ==')
console.log(JSON.stringify(brief('1:96'), null, 1))
console.log('== screen1 Layout 1:98 ==')
console.log(JSON.stringify(brief('1:98'), null, 1))
console.log('== screen2 Layout copy 1:99 ==')
console.log(JSON.stringify(brief('1:99'), null, 1))
console.log('== slot copies ==')
for (const id of ['1:8000000788', '1:8000000796']) console.log(JSON.stringify(brief(id), null, 1))
