// Иконки мини-бара сайдбара: сверху вниз lock-keyhole, layout-grid, moon.
//
// В мастере `sidebar` (вариант genom 2.0_1) рейл держит статус и кнопки меню,
// а внутри у них маркер `wine`: глиф подставляют свопом. Здесь он и
// подставляется — в самом компоненте, чтобы правка разошлась по всем копиям.
//
// Запуск: bun tools/ds/rail-icons.mjs <вход.fig> <выход.fig>
import { readFile, writeFile } from 'node:fs/promises'

import * as corePkg from '@open-pencil/core'
import { exportFigFile } from '@open-pencil/core/io'
import { releaseFigPopulationWorker } from '@open-pencil/core/kiwi'
import * as figPkg from '@open-pencil/fig'
import { stringToGuid } from '@open-pencil/fig/node-change'

const [input, output] = process.argv.slice(2)
if (!input || !output) {
  console.error('нужно: bun tools/ds/rail-icons.mjs <вход.fig> <выход.fig>')
  process.exit(1)
}

const bytes = new Uint8Array(await readFile(input))
const parsed = figPkg.parseFigBuffer(bytes.buffer)
const graph = corePkg.importNodeChanges(parsed.nodeChanges, parsed.blobs, new Map(parsed.images), {
  populate: 'all'
})

const kids = (node) => (node?.childIds ?? []).map((id) => graph.getNode(id)).filter(Boolean)
const componentNamed = (name) => {
  const found = [...graph.nodes.values()].find(
    (node) => node.type === 'COMPONENT' && node.name.trim() === name
  )
  if (!found) throw new Error(`нет компонента «${name}»`)
  return found
}
const findDeep = (node, predicate) => {
  for (const child of kids(node)) {
    if (predicate(child)) return child
    const found = findDeep(child, predicate)
    if (found) return found
  }
  return null
}

/**
 * Запись о свопе для файла.
 *
 * Содержимое копии в файл не пишется: у кнопки рейла глиф лежит на два уровня
 * глубже, и одной живой ссылки мало — после перечитывания там снова маркер.
 * Пишем путь к узлу мастера и ссылку на новую иконку в записи держателя.
 */
function recordSwap(holder, masterNode, target) {
  const from = masterNode?.source?.id ? stringToGuid(masterNode.source.id) : null
  const to = target?.source?.id ? stringToGuid(target.source.id) : null
  if (!from || !to) {
    console.log(`  запись о свопе не сделана: ${holder.name.trim()} → ${target.name.trim()}`)
    return
  }
  const source = holder.source ?? {}
  graph.updateNode(holder.id, {
    source: {
      ...source,
      editedFields: (source.editedFields ?? []).filter(
        (field) => field !== 'componentPropertyAssignments'
      ),
      fig: {
        ...(source.fig ?? {}),
        symbolOverrides: [
          ...(source.fig?.symbolOverrides ?? []),
          { guidPath: { guids: [from] }, overriddenSymbolID: to }
        ]
      }
    }
  })
}

/**
 * Ставит глиф в кнопке рейла.
 *
 * Меняем обёртку `icon`, а не маркер `wine` внутри неё: маркер лежит на
 * уровень глубже, и своп на том уровне в файл не доезжает — после
 * перечитывания там снова маркер. Обёртка — тот же уровень, что у иконок
 * в кнопках и полях, и её своп сохраняется.
 */
function setGlyph(holder, iconName, size) {
  const icon = findDeep(holder, (node) => node.type === 'INSTANCE' && node.name.trim() === 'icon')
  if (!icon) throw new Error(`в «${holder.name.trim()}» нет обёртки icon`)
  const masterNode = icon.componentId ? graph.getNode(icon.componentId) : null
  const target = componentNamed(iconName)
  graph.swapInstanceComponent(icon.id, target.id)
  recordSwap(holder, masterNode, target)
  const placed = findDeep(holder, (node) => node.type === 'INSTANCE' && node.name.trim() === iconName)
  if (placed) graph.updateNode(placed.id, { width: size, height: size })
  return iconName
}

const set = [...graph.nodes.values()].find(
  (node) => node.type === 'COMPONENT_SET' && node.name.trim() === 'sidebar'
)
if (!set) throw new Error('нет набора «sidebar»')
const variant = kids(set).find((node) => node.name.trim() === 'Property 1=genom 2.0_1')
if (!variant) throw new Error('нет варианта sidebar / genom 2.0_1')

const rail = kids(variant)[0]
const [topSlot, bottomSlot] = kids(kids(rail)[0])
const applied = []

// Верх: статус с замком, затем кнопка с сеткой.
const status = kids(topSlot).find((node) => node.name.trim() === 'status')
if (status) {
  const statusSet = status.componentId
    ? graph.getNode(graph.getNode(status.componentId)?.parentId ?? '')
    : null
  const lock = kids(statusSet).find(
    (node) =>
      node.type === 'COMPONENT' && (node.componentPropertyValues ?? {})['Property 1'] === 'lock'
  )
  if (lock) graph.swapInstanceComponent(status.id, lock.id)
  const placed = graph.getNode(status.id)
  applied.push('status → ' + setGlyph(placed ?? status, 'lock-keyhole', 12))
}
const topButton = kids(topSlot).find(
  (node) => node.name.trim() === 'Menu button' && node.visible !== false
)
if (topButton) applied.push('верхняя кнопка → ' + setGlyph(topButton, 'layout-grid', 16))

// Низ: одна кнопка с луной, лишнюю прячем.
const bottomButtons = kids(bottomSlot).filter(
  (node) => node.name.trim() === 'Menu button' && node.visible !== false
)
if (bottomButtons[0]) applied.push('нижняя кнопка → ' + setGlyph(bottomButtons[0], 'moon', 16))
for (const extra of bottomButtons.slice(1)) {
  graph.updateNode(extra.id, { visible: false })
  applied.push('лишняя кнопка скрыта')
}

console.log('иконки рейла: ' + applied.join(', '))

releaseFigPopulationWorker(graph)
const exported = await exportFigFile(graph, undefined, undefined, undefined, false, {
  noImplicitInternalCanvas: true
})
await writeFile(
  output,
  Buffer.from(exported.buffer.slice(exported.byteOffset, exported.byteOffset + exported.byteLength))
)
console.log(`записано: ${output}`)
