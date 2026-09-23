import * as v from 'valibot'

import { nodeIdInput } from '#core/tools/input'
import { defineTool } from '#core/tools/schema'
import { releaseOriginalFigArchive } from '#core/kiwi/fig/session/original-archive'
import { ensureSlotProperty } from '#core/tools/slot-property'
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
  execution: { kind: 'sync', mutation: 'document' },
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

    // Слот внутри инстанса: наполнение не сохранится. Говорим сразу и прямо,
    // иначе работа пропадёт после закрытия документа.
    const scope = slotScopeOf(figma.graph, slot.id)
    if (scope === 'instance') {
      return {
        error:
          `Slot "${slot.name.trim()}" (${slot.id}) sits inside an instance. A block placed there shows on the canvas and is not written to the file. ` +
          'Fill the same slot in the master instead — the master component is the one this instance points at.',
        slotScope: scope
      }
    }
    if (scope === 'page') {
      return {
        error: `Node "${slot.id}" is not inside a component or instance, so there is no master to fill. Place the block directly if this is your own layout.`,
        slotScope: scope
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

    // Пометки мало: чтобы содержимое пережило сохранение, место должно быть
    // свойством компонента. Доводим помеченный фрейм до настоящего слота —
    // заводим свойство типа SLOT у владельца и привязываем фрейм к нему.
    //
    // Свойство живёт у места в мастере: узел в рабочей копии файл не хранит.
    // Поэтому если выделен слот внутри инстанса, содержимое кладём в его
    // мастер-двойник — так Figma и работает, и оно разойдётся по копиям.
    const slotProperty = ensureSlotProperty(figma.graph, slot.id)
    const targetSlotId = slotProperty?.slotId ?? slot.id
    if (targetSlotId !== slot.id) {
      const masterSlot = figma.graph.getNode(targetSlotId)
      if (!masterSlot) return { error: `Slot master for "${slot.name.trim()}" not found` }
    }

    // Заливка слота — служебная плашка. С блоком она видна поверх него, поэтому
    // снимаем: место слота остаётся, а плашка уходит.
    const clearsFill = Array.isArray(slot.fills) && slot.fills.length > 0
    if (clearsFill) figma.graph.updateNode(slot.id, { fills: [] })

    const instance = figma.graph.createInstance(target.id, targetSlotId)
    if (!instance) return { error: `Failed to place "${target.name.trim()}" into the slot` }

    const removed: string[] = []
    if (replace) {
      // Прежнее содержимое ищем в целевом слоте: если наполняли мастер,
      // там и лежит то, что надо убрать.
      const inTarget = figma.graph.getNode(targetSlotId)?.childIds ?? []
      for (const childId of inTarget) {
        if (childId === instance.id) continue
        figma.graph.deleteNode(childId)
        removed.push(childId)
      }
      // И в исходном слоте, если это была другая копия.
      if (targetSlotId !== slot.id) {
        for (const child of existing) {
          if (child.id === instance.id) continue
          figma.graph.deleteNode(child.id)
          removed.push(child.id)
        }
      }
    }

    // Правка узлов внутри инстанса не переживает сохранение, но сам факт
    // изменения делает исходный архив негодным: без сброса экспорт вернёт
    // старый файл целиком.
    releaseOriginalFigArchive(figma.graph)

    return {
      slot: targetSlotId,
      requestedSlot: slot.id,
      placed: instance.id,
      component: target.id,
      componentName: target.name.trim(),
      ...(existing.length > 0 ? { replaced: existing } : {}),
      ...(removed.length > 0 ? { removed } : {}),
      ...(clearsFill ? { clearedSlotFill: true } : {}),
      ...(slotProperty ? { slotProperty: slotProperty.propertyId, slotIsReal: true } : {}),
      note: slotProperty
        ? slotProperty.scope === 'instance'
          ? 'The block is in the slot of this master, so every instance of it gets a copy and the content saves with the file. The slot itself stays for the next block. The master layout structure is unchanged.'
          : 'The block is in place as an instance inside a real slot property: it saves with the file, the slot stays for the next block, and the master layout is unchanged.'
        : 'The block is in place as an instance inside the slot. Warning: the slot is not backed by a SLOT component property, so the content may not survive saving.'
    }
  }
})

/** Где лежит узел: в мастере, в инстансе или на странице. */
function slotScopeOf(
  graph: { getNode: (id: string) => { parentId?: string | null; type: string } | undefined },
  nodeId: string
): 'master' | 'instance' | 'page' {
  let current = graph.getNode(nodeId)
  while (current?.parentId) {
    const parent = graph.getNode(current.parentId)
    if (!parent) break
    if (parent.type === 'COMPONENT' || parent.type === 'COMPONENT_SET') return 'master'
    if (parent.type === 'INSTANCE') return 'instance'
    current = parent
  }
  return 'page'
}

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
