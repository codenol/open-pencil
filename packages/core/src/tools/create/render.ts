import * as v from 'valibot'
import { ensureSlotProperty } from '#core/tools/slot-property'

import { toolNumber } from '#core/tools/input'
import { defineTool } from '#core/tools/schema'

export const render = defineTool({
  name: 'render',

  description:
    'Render JSX to design nodes. Supports inline SVG paths, including open stroked paths: <svg viewBox="0 0 24 24" size={24}><path d="M2 12 L22 12" stroke="#000" fill="none" /></svg>. Use replace_id to replace a placeholder while preserving its position.',
  execution: { kind: 'async', mutation: 'document' },
  input: v.object({
    replace_id: v.optional(
      v.pipe(
        v.string(),
        v.description(
          'Node ID to replace — new node takes its position in parent, old node is deleted'
        )
      )
    ),
    parent_id: v.optional(v.pipe(v.string(), v.description('Parent node ID to render into'))),
    insert_index: v.optional(
      toolNumber(
        v.pipe(
          v.number(),
          v.description('Position among siblings (0 = first child). Omit to append at end.')
        )
      )
    ),
    x: v.optional(toolNumber(v.pipe(v.number(), v.description('X position of the root node')))),
    y: v.optional(toolNumber(v.pipe(v.number(), v.description('Y position of the root node')))),
    jsx: v.pipe(v.string(), v.description('JSX string to render'))
  }),
  execute: async (figma, args) => {
    const { renderJSX } = await import('#core/design-jsx/render.js')

    let parentId = args.parent_id ?? figma.currentPageId
    let replaceIndex = -1

    // Рисовать прямо в место рабочей копии бессмысленно: узлы внутри инстанса
    // в файл не пишутся, и работа пропадает при сохранении.
    //
    // Место может быть ещё не настоящим — помеченным, но без свойства типа
    // SLOT. Тогда сначала доводим его до настоящего, а затем уводим правку в
    // мастера: иначе рисунок уедет в копию и пропадёт.
    let redirectedTo: string | null = null
    const parentNode = figma.graph.getNode(parentId)
    if (parentNode && isInstanceSlotCandidate(parentNode)) {
      const slotProperty = ensureSlotProperty(figma.graph, parentNode.id)
      const targetSlotId = slotProperty?.slotId ?? parentNode.id
      const targetNode = figma.graph.getNode(targetSlotId)
      if (targetNode && targetNode.id !== parentNode.id) {
        parentId = targetNode.id
        redirectedTo = targetNode.id
      }
    }

    if (args.replace_id) {
      const target = figma.graph.getNode(args.replace_id)
      if (target?.parentId) {
        parentId = target.parentId
        const parent = figma.graph.getNode(parentId)
        if (parent) {
          replaceIndex = parent.childIds.indexOf(args.replace_id)
        }
      }
    }

    const results = await renderJSX(figma.graph, args.jsx, {
      parentId,
      x: args.x,
      y: args.y
    })
    const result = results[0]

    if (args.replace_id && replaceIndex >= 0) {
      figma.graph.reorderChild(result.id, parentId, replaceIndex)
      figma.graph.deleteNode(args.replace_id)
    } else if (args.insert_index !== undefined) {
      figma.graph.reorderChild(result.id, parentId, args.insert_index)
    }

    const response: {
      id: string
      name: string
      type: string
      children: string[]
      warnings?: typeof result.warnings
      siblings?: Array<{ id: string; name: string; type: string }>
      redirectedTo?: string
      note?: string
    } = {
      id: result.id,
      name: result.name,
      type: result.type,
      children: result.childIds,
      ...(redirectedTo
        ? {
            redirectedTo,
            note: `You asked to draw into a slot of a working copy. That content would not be saved, so it went into the same slot of the master instead — you will see it once the copy refreshes. Use fill_slot when the block already exists as a component.`
          }
        : {})
    }
    if (result.warnings) response.warnings = result.warnings
    if (results.length > 1) {
      response.siblings = results
        .slice(1)
        .map((node) => ({ id: node.id, name: node.name, type: node.type }))
    }
    return response
  }
})

/**
 * Узел внутри рабочей копии, который может быть местом под содержимое.
 *
 * Настоящий слот виден по ссылке на свойство. Но место бывает и помеченным,
 * без свойства — тогда его сначала надо довести до настоящего, и уже потом
 * решать, куда рисовать. Узел самого компонента владельцем не считается.
 */
function isInstanceSlotCandidate(node: {
  componentPropertyReferences?: { field: string }[]
  type: string
  componentId?: string | null
  pluginData?: { key: string; value: string }[]
  name?: string
}): boolean {
  if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') return false
  // Место внутри копии видно по трём признакам, и достаточно любого: ссылка на
  // свойство, пометка в pluginData, имя. Пометку ставит разметка файла, и она
  // не всегда доезжает до сохранённого документа — на неё одну полагаться
  // нельзя, иначе рисунок уходит в копию и пропадает.
  const linked = (node.componentPropertyReferences ?? []).some((ref) => ref.field === 'SLOT')
  const marked = (node.pluginData ?? []).some((entry) => entry.key === 'slot')
  const named = /slot/i.test((node.name ?? '').trim()) || /^main container$/i.test((node.name ?? '').trim())
  if (!linked && !marked && !named) return false
  return Boolean(node.componentId) || linked
}
