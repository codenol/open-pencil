import * as v from 'valibot'

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
    // в файл не пишутся, и работа пропадает при сохранении. Слот инстанса
    // знает своего мастера через componentId — уводим правку туда и говорим
    // об этом, чтобы автор не считал, будто нарисовал в выделенном узле.
    let redirectedTo: string | null = null
    const parentNode = figma.graph.getNode(parentId)
    if (parentNode && isInstanceSlot(parentNode)) {
      const master = masterSlotOf(figma.graph, parentNode)
      if (master) {
        parentId = master.id
        redirectedTo = master.id
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

/** Место ли это внутри рабочей копии — по ссылке на свойство. */
function isInstanceSlot(node: { componentPropertyReferences?: { field: string }[]; type: string }): boolean {
  if (!(node.componentPropertyReferences ?? []).some((ref) => ref.field === 'SLOT')) return false
  return node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET'
}

/** Двойник места в мастере: слот копии ссылается на него через componentId. */
function masterSlotOf(
  graph: { getNode: (id: string) => { id: string; type: string; componentId?: string | null } | undefined },
  slot: { componentId?: string | null }
): { id: string } | null {
  if (!slot.componentId) return null
  const master = graph.getNode(slot.componentId)
  if (!master) return null
  if (master.type === 'COMPONENT' || master.type === 'COMPONENT_SET') return null
  return { id: master.id }
}
