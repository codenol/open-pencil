// Нарезка крупной страницы по группам верхнего уровня: если страница не влезает
// в редактор, режем её на части по секциям/фреймам верхнего уровня.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import * as figPkg from '/opt/open-pencil/packages/fig/dist/index.js'
import * as corePkg from '/opt/open-pencil/packages/core/dist/index.js'
import { exportFigFile } from '/opt/open-pencil/packages/core/dist/io/formats/fig/index.js'
import { SceneGraph } from '/opt/open-pencil/packages/scene-graph/dist/index.js'

const SOURCE = '/opt/open-pencil/data/ds-unpacked/canvas.fig'
const OUT_DIR = '/opt/open-pencil/data/ds-chunks'
const MAX_NODES = Number(process.argv[2] ?? 1800)
const PAGES = process.argv.slice(3).length > 0 ? process.argv.slice(3) : null

await mkdir(OUT_DIR, { recursive: true })
const bytes = new Uint8Array(await readFile(SOURCE))
const parsed = figPkg.parseFigBuffer(bytes.buffer)
const full = corePkg.importNodeChanges(parsed.nodeChanges, parsed.blobs, new Map(parsed.images), {
  populate: 'none'
})

const countTree = (id) => {
  let count = 0
  const stack = [id]
  while (stack.length > 0) {
    const node = full.getNode(stack.pop())
    if (!node) continue
    count += 1
    for (const child of node.childIds) stack.push(child)
  }
  return count
}

function subgraphFor(keepRoots, pageName) {
  const keep = new Set([full.rootId, ...keepRoots])
  const queue = [...keepRoots]
  while (queue.length > 0) {
    const node = full.getNode(queue.pop())
    if (!node) continue
    for (const child of node.childIds) {
      if (keep.has(child)) continue
      keep.add(child)
      queue.push(child)
    }
  }
  const sub = new SceneGraph()
  sub.rootId = full.rootId
  sub.documentColorSpace = full.documentColorSpace
  sub.figKiwiVersion = full.figKiwiVersion
  sub.enabledLibraries = new Map(full.enabledLibraries)
  for (const [id, node] of full.nodes) {
    if (!keep.has(id)) continue
    sub.nodes.set(id, { ...node, childIds: node.childIds.filter((c) => keep.has(c)) })
  }
  for (const [id, ids] of full.instanceIndex) {
    if (!keep.has(id)) continue
    sub.instanceIndex.set(id, new Set([...ids].filter((i) => keep.has(i))))
  }
  // корень документа держит только нашу страницу-носитель
  const root = sub.nodes.get(sub.rootId)
  if (root) {
    root.childIds = root.childIds.filter((id) => {
      const node = sub.nodes.get(id)
      return node?.type === 'CANVAS' && node.name?.trim() === pageName
    })
  }
  return sub
}

/** Режет страницу на группы: каждая группа — поддерево верхнего уровня ≤ MAX_NODES. */
function splitPage(page) {
  const children = page.childIds.map((id) => ({ id, node: full.getNode(id), nodes: countTree(id) }))
  const groups = []
  let current = { roots: [], nodes: 0 }
  for (const child of children.filter((c) => c.nodes > 0)) {
    if (child.nodes >= MAX_NODES) {
      // сам ребёнок слишком большой — режем его детей
      if (current.roots.length > 0) {
        groups.push(current)
        current = { roots: [], nodes: 0 }
      }
      const sub = child.node.childIds.map((id) => ({ id, nodes: countTree(id) }))
      let inner = { roots: [], nodes: 0 }
      for (const part of sub) {
        if (inner.nodes + part.nodes > MAX_NODES && inner.roots.length > 0) {
          groups.push(inner)
          inner = { roots: [], nodes: 0 }
        }
        inner.roots.push(part.id)
        inner.nodes += part.nodes
      }
      if (inner.roots.length > 0) groups.push(inner)
      continue
    }
    if (current.nodes + child.nodes > MAX_NODES && current.roots.length > 0) {
      groups.push(current)
      current = { roots: [], nodes: 0 }
    }
    current.roots.push(child.id)
    current.nodes += child.nodes
  }
  if (current.roots.length > 0) groups.push(current)
  return groups
}

const pages = full.getPages(true).filter((page) => {
  if (page.internalOnly) return false
  if (PAGES) return PAGES.some((name) => page.name.includes(name))
  return countTree(page.id) > MAX_NODES
})

console.log(`страниц к нарезке: ${pages.length} (порог ${MAX_NODES} нод)`)
const manifest = []
for (const page of pages) {
  const pageName = page.name.trim()
  const total = countTree(page.id)
  const groups = splitPage(page)
  console.log(`\n«${pageName.slice(0, 34)}» — ${total} нод → ${groups.length} частей`)
  const safePage = pageName.replace(/[^\wа-яА-ЯёЁ\- ]+/gu, '').replace(/\s+/g, '-').slice(0, 30) || 'page'
  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index]
    const sub = subgraphFor(group.roots, pageName)
    const fileName = `${safePage}-${index + 1}.fig`
    try {
      const out = await exportFigFile(sub, undefined, undefined, page.childIds[0] ?? page.id)
      await writeFile(`${OUT_DIR}/${fileName}`, out)
      const names = group.roots.slice(0, 2).map((id) => full.getNode(id)?.name?.trim().slice(0, 18)).join(', ')
      manifest.push({ page: pageName, file: fileName, nodes: group.nodes, bytes: out.byteLength })
      console.log(`  часть ${index + 1}: ${group.nodes} нод (${Math.round(out.byteLength / 1024)} КБ) — ${names}`)
    } catch (error) {
      manifest.push({ page: pageName, file: fileName, nodes: group.nodes, error: String(error).slice(0, 120) })
      console.log(`  часть ${index + 1}: ОШИБКА ${String(error).slice(0, 90)}`)
    }
  }
}

await writeFile(`${OUT_DIR}/manifest.json`, JSON.stringify({ source: SOURCE, maxNodes: MAX_NODES, chunks: manifest }, null, 1))
const done = manifest.filter((m) => m.bytes)
console.log(`\nготово частей: ${done.length} | нод: ${done.reduce((s, m) => s + m.nodes, 0)} | вес: ${(done.reduce((s, m) => s + m.bytes, 0) / 1048576).toFixed(1)} МБ`)
