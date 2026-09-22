import * as v from 'valibot'

import { nodeIdInput } from '#core/tools/input'
import { defineTool } from '#core/tools/schema'
import { readSlot } from '#core/tools/slots'

/**
 * Заполнение слота готовым блоком.
 *
 * Слот — место под блок. Наполнять его узлами напрямую нельзя: узлы,
 * добавленные в инстанс, на экране видны, но в файл не пишутся, и работа
 * пропадает после сохранения. Слот занимают иначе — ставят в него инстанс
 * компонента. Тогда содержимое принадлежит компоненту, сохраняется, а мастер
 * не меняется: его слот просто занят.
 *
 * Слот может быть непустым, и это нормально — в нём уже может лежать то, что
 * нужно. Поэтому сначала смотрим, что внутри, и заменяем только осмысленно:
 * прежнее содержимое возвращается в ответе, чтобы человек решил сам.
 */
export const fillSlot = defineTool({
  name: 'fill_slot',
  description:
    'Put a block into a slot. Pass the slot node and the component to place. The block goes in as an instance, so it saves and the master stays unchanged. If the slot is already filled, the current content is reported before it is replaced.',
  execution: { kind: 'sync', mutation: 'structure' },
  input: v.object({
    id: nodeIdInput,
    component_id: v.pipe(
      v.string(),
      v.description('Component or component set to place into the slot')
    ),
    variant_values: v.optional(
      v.pipe(v.string(), v.description('Optional JSON of variant values, e.g. {"Size":"16"}'))
    ),
    replace: v.optional(
      v.pipe(
        v.boolean(),
        v.description('Replace existing content. Default true — the slot holds one block.')
      )
    )
  }),
  execute: (figma, args) => {
    const slot = figma.graph.getNode(args.id)
    if (!slot) return { error: `Node "${args.id}" not found` }

    // Слот или нет — сообщаем прямо: инструмент можно позвать и по ошибке.
    const marked = readSlot(slot) !== null
    const looksLikeSlot = marked || /slot|main container/i.test(slot.name.trim())
    if (!looksLikeSlot) {
      return {
        error: `Node "${args.id}" ("${slot.name.trim()}") is not marked as a slot. Pass a slot node, or mark this one first.`
      }
    }

    const target = resolveTarget(figma.graph, args.component_id, args.variant_values)
    if ('error' in target) return target

    // Что уже лежит внутри: человек должен знать, что заменяется.
    const existing = slot.childIds.map((childId) => {
      const child = figma.graph.getNode(childId)
      if (!child) return { id: childId, type: 'UNKNOWN', name: '' }
      const master = child.type === 'INSTANCE' ? figma.graph.getNode(child.componentId ?? '') : null
      return {
        id: child.id,
        type: child.type,
        name: child.name.trim(),
        ...(master ? { of: master.name.trim() } : {})
      }
    })

    // Внутри уже нужный компонент — не трогаем.
    const alreadyRight =
      existing.length === 1 &&
      existing[0].type === 'INSTANCE' &&
      figma.graph.getNode(slot.childIds[0])?.componentId === target.id
    if (alreadyRight) {
      return { slot: slot.id, placed: existing[0].id, unchanged: true, note: 'The slot already holds this component.' }
    }

    const replace = args.replace ?? true
    if (existing.length > 0 && !replace) {
      return {
        slot: slot.id,
        filled: false,
        existing,
        note: 'The slot is not empty and replace was false. Reported the content without changing anything.'
      }
    }

    // Заливка слота — служебная плашка. С блоком она видна поверх него, поэтому
    // снимаем: место слота остаётся, а плашка уходит.
    const clearsFill = Array.isArray(slot.fills) && slot.fills.length > 0
    if (clearsFill) figma.graph.updateNode(slot.id, { fills: [] })

    const instance = figma.graph.createInstance(target.id, slot.id)
    if (!instance) return { error: `Failed to place "${target.name.trim()}" into the slot` }

    const removed: string[] = []
    if (replace) {
      for (const child of existing) {
        // Сам инстанс не трогаем: он только что создан в этом же слоте.
        if (child.id === instance.id) continue
        figma.graph.deleteNode(child.id)
        removed.push(child.id)
      }
    }

    return {
      slot: slot.id,
      placed: instance.id,
      component: target.id,
      componentName: target.name.trim(),
      ...(existing.length > 0 ? { replaced: existing } : {}),
      ...(removed.length > 0 ? { removed } : {}),
      ...(clearsFill ? { clearedSlotFill: true } : {}),
      note: 'The block is in place as an instance inside the slot: it saves with the file, the slot stays for the next block, and the master is unchanged.'
    }
  }
})

/** Компонент для вставки: сам узел или вариант из сета. */
function resolveTarget(
  graph: { getNode: (id: string) => { id: string; type: string; name: string; childIds: string[] } | undefined },
  componentId: string,
  variantValues?: string
): { id: string; name: string } | { error: string } {
  const node = graph.getNode(componentId)
  if (!node) return { error: `Component "${componentId}" not found` }
  if (node.type === 'COMPONENT') return { id: node.id, name: node.name }

  if (node.type === 'COMPONENT_SET') {
    let wanted: Record<string, string> = {}
    if (variantValues) {
      try {
        wanted = JSON.parse(variantValues) as Record<string, string>
      } catch {
        return { error: `variant_values is not valid JSON: ${variantValues}` }
      }
    }
    const names = Object.entries(wanted).map(([key, value]) => `${key}=${value}`)
    const variants = node.childIds
      .map((id) => graph.getNode(id))
      .filter((child): child is NonNullable<typeof child> => Boolean(child))

    const match =
      names.length > 0
        ? variants.find((variant) => names.every((pair) => variant.name.includes(pair)))
        : variants[0]
    if (!match) {
      return {
        error: `No variant of "${node.name.trim()}" matches ${JSON.stringify(wanted)}. Available: ${variants.map((variant) => variant.name.trim()).slice(0, 6).join(' | ')}`
      }
    }
    return { id: match.id, name: match.name }
  }

  return { error: `Component "${componentId}" is ${node.type}, not a component or set` }
}
