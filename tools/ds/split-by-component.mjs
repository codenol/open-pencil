// Режет выгрузку ДС на отдельные файлы: один компонент — один файл.
// Так же, как в Figma: заходишь в компонент и видишь только его.
import { readFile, writeFile, mkdir } from 'node:fs/promises'

import * as figPkg from '/opt/open-pencil/packages/fig/dist/index.js'
import * as corePkg from '/opt/open-pencil/packages/core/dist/index.js'
import { exportFigFile } from '/opt/open-pencil/packages/core/dist/io/formats/fig/index.js'
import { SceneGraph } from '/opt/open-pencil/packages/scene-graph/dist/index.js'

const SOURCES = [
  '/opt/open-pencil/data/ds-components/components-1.fig',
  '/opt/open-pencil/data/ds-components/components-2.fig'
]
const OUT_DIR = '/opt/open-pencil/data/ds-by-component'

await mkdir(OUT_DIR, { recursive: true })

/** Копирует поддерево, сохраняя только переносимые поля. */
const TRANSIENT = new Set(['id', 'parentId', 'childIds', 'source'])
function copyTree(source, target, nodeId, parentId) {
  const node = source.getNode(nodeId)
  if (!node) return null
  const props = {}
  for (const [key, value] of Object.entries(node)) {
    if (TRANSIENT.has(key) || value === undefined) continue
    props[key] = value
  }
  const created = target.createNode(node.type, parentId, props)
  for (const childId of node.childIds) copyTree(source, target, childId, created.id)
  return created
}

const manifest = []

for (const file of SOURCES) {
  const bytes = new Uint8Array(await readFile(file))
  const parsed = figPkg.parseFigBuffer(bytes.buffer)
  const source = corePkg.importNodeChanges(parsed.nodeChanges, parsed.blobs, new Map(parsed.images), {
    populate: 'none'
  })

  // корневые компоненты (варианты внутри сета не берём как отдельные файлы)
  const roots = []
  for (const node of source.getAllNodes()) {
    if (node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET') continue
    if (node.parentId && source.getNode(node.parentId)?.type === 'COMPONENT_SET') continue
    roots.push(node)
  }

  for (const root of roots) {
    const target = new SceneGraph()
    const page = target.getPages()[0]

    // Внутри сета каждый вариант должен получить свою страницу — как в Figma.
    if (root.type === 'COMPONENT_SET') {
      for (const variantId of root.childIds) {
        const variant = source.getNode(variantId)
        if (!variant) continue
        const single = new SceneGraph()
        const pageSingle = single.getPages()[0]
        pageSingle.name = `${variant.name}`.slice(0, 60)
        // обёртка-сет нужна, чтобы вариант остался вариантом со свойствами
        const setCopy = copyTree(source, single, root.id, pageSingle.id)
        if (!setCopy) continue
        // оставляем только этот вариант
        for (const childId of [...setCopy.childIds]) {
          const child = single.getNode(childId)
          if (!child) continue
          if (child.name !== variant.name) single.deleteNode(childId)
        }
        await save(single, sanitize(variant.name), pageSingle.name)
      }
      continue
    }

    page.name = root.name
    const placeholder = copyTree(source, target, root.id, page.id)
    if (!placeholder) continue
    target.rootId = target.rootId
    // Переменные переносим: без них теряются привязки заливок к токенам.
    for (const [id, variable] of source.variables) target.variables.set(id, variable)
    for (const [id, collection] of source.variableCollections) {
      target.variableCollections.set(id, collection)
    }
    for (const [modeId, value] of source.activeMode) target.activeMode.set(modeId, value)
    await save(target, sanitize(root.name), root.name)
  }
}

function sanitize(name) {
  return (
    name
      .trim()
      .replace(/[^\wа-яА-ЯёЁ\- ]+/gu, '')
      .replace(/\s+/g, '-')
      .slice(0, 50) || 'component'
  )
}

async function save(graph, fileName, label) {
  try {
    const out = await exportFigFile(graph, undefined, undefined, undefined, false, {
      noImplicitInternalCanvas: true
    })
    await writeFile(`${OUT_DIR}/${fileName}.fig`, out)
    let nodes = 0
    for (const _ of graph.getAllNodes()) nodes += 1
    manifest.push({ file: `${fileName}.fig`, label, nodes, bytes: out.byteLength })
    console.log(`  ${String(nodes).padStart(5)} нод → ${fileName}.fig (${Math.round(out.byteLength / 1024)} КБ)`)
  } catch (error) {
    manifest.push({ file: `${fileName}.fig`, label, error: String(error).slice(0, 120) })
    console.log(`  ОШИБКА ${fileName}: ${String(error).slice(0, 90)}`)
  }
}

await writeFile(`${OUT_DIR}/manifest.json`, JSON.stringify({ files: manifest }, null, 1))
const done = manifest.filter((m) => m.bytes)
console.log(`\nфайлов: ${done.length} | нод: ${done.reduce((s, m) => s + m.nodes, 0)} | вес: ${(done.reduce((s, m) => s + m.bytes, 0) / 1048576).toFixed(2)} МБ`)
