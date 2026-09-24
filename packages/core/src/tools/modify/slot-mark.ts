import * as v from 'valibot'

import { nodeIdInput } from '#core/tools/input'
import { defineTool } from '#core/tools/schema'
import { releaseOriginalFigArchive } from '#core/kiwi/fig/session/original-archive'
import {
  ensureSlotProperty,
  getSlotPropertyInfo,
  removeSlotProperty
} from '#core/tools/slot-property'

/**
 * Пометка места под блок — как переключатель SLOT в панели «Дизайн».
 *
 * Ставить пометку можно только в мастер-компоненте: свойство типа SLOT
 * заводится у компонента-владельца, место подсвечивается розовым. Копия
 * слота внутри инстанса наследует пометку от мастера — после этого её
 * наполнение меняется через swap_component.
 */
export const markSlot = defineTool({
  name: 'mark_slot',
  description:
    'Mark a frame inside a master component as a SLOT — a placeholder that instances fill with their own content (same as the SLOT toggle in the Design panel). The frame gets a pink highlight in the master. After marking, fill the slot on a specific instance with swap_component: pass the slot copy inside that instance and the wrapper component. Pass enabled=false to unmark. Slots can only be marked inside a master component, not on a plain page.',
  execution: { kind: 'sync', mutation: 'document' },
  input: v.object({
    id: nodeIdInput,
    enabled: v.optional(
      v.pipe(v.boolean(), v.description('Default true. Pass false to remove the slot mark.'))
    )
  }),
  execute: (figma, args) => {
    const node = figma.graph.getNode(args.id)
    if (!node) return { error: `Node "${args.id}" not found` }

    if (args.enabled === false) {
      const removed = removeSlotProperty(figma.graph, args.id)
      if (!removed) {
        return { error: `Node "${args.id}" ("${node.name.trim()}") is not a slot` }
      }
      releaseOriginalFigArchive(figma.graph)
      return { id: args.id, slot: false, note: 'Slot mark removed; instances no longer fill this place.' }
    }

    const existing = getSlotPropertyInfo(figma.graph, args.id)
    if (existing) {
      return {
        id: args.id,
        slot: true,
        already: true,
        slotId: existing.slotId,
        slotProperty: existing.propertyId,
        scope: existing.scope
      }
    }

    const created = ensureSlotProperty(figma.graph, args.id)
    if (!created) {
      return {
        error: `Node "${args.id}" ("${node.name.trim()}") is not inside a component. Slots can only be marked inside a master component.`
      }
    }
    releaseOriginalFigArchive(figma.graph)
    return {
      id: args.id,
      slot: true,
      slotId: created.slotId,
      slotProperty: created.propertyId,
      ownerId: created.ownerId,
      scope: created.scope,
      note: 'The frame is a real slot now: it highlights pink in the master, and each instance fills it via swap_component on the slot copy.'
    }
  }
})
