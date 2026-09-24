import * as v from 'valibot'

import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import type { FigmaAPI } from '#core/figma-api'
import { nodeIdInput } from '#core/tools/input'
import { defineTool } from '#core/tools/schema'
import { releaseOriginalFigArchive } from '#core/kiwi/fig/session/original-archive'
import { ensureSlotProperty } from '#core/tools/slot-property'
import { isSlotNode } from '#core/tools/slots'

import { getSlotContentId, swapSlotContent } from './swap'

/** Что уже лежит в месте: id, вид, имя и, для копии, её мастер. */
interface SlotContentEntry {
  id: string
  type: string
  name: string
  of?: string
}

/**
 * Заполнение слота готовым блоком.
 *
 * Слот — место под блок. Наполнять его узлами напрямую нельзя: узлы,
 * добавленные в инстанс, на экране видны, но в файл не пишутся, и работа
 * пропадает после сохранения. Слот занимают иначе — ставят в него инстанс
 * компонента. Тогда содержимое принадлежит компоненту, сохраняется, а мастер
 * не меняется: его слот просто занят.
 *
 * Кого именно касается правка, решает узел, который дали. Место внутри
 * рабочей копии — это экран: назначение ложится на его экземпляр, соседние
 * экраны и мастер остаются как были. Место в мастере — общий случай: блок
 * расходится по всем копиям.
 *
 * Слот может быть непустым, и это нормально — в нём уже может лежать то, что
 * нужно. Поэтому сначала смотрим, что внутри, и заменяем только осмысленно:
 * прежнее содержимое возвращается в ответе, чтобы человек решил сам.
 */
export const fillSlot = defineTool({
  name: 'fill_slot',
  description:
    'Put a block into a slot. Pass the slot node and the component to place. A slot inside a screen belongs to that screen: the assignment lands on that instance and the other screens keep their slots as they were. A slot in a master is the shared default — every screen gets the block. The block goes in as an instance, so it saves. If the slot is already filled, the current content is reported before it is replaced.',
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
    const marked = isSlotNode(figma.graph, slot)
    const looksLikeSlot = marked || /slot|main container/i.test(slot.name.trim())
    if (!looksLikeSlot) {
      return {
        error: `Node "${args.id}" ("${slot.name.trim()}") is not marked as a slot. Pass a slot node, or mark this one first.`
      }
    }

    // Раньше слот внутри инстанса отвергался: «наполнение не сохранится».
    // Теперь это не так — ниже место доводится до настоящего и содержимое
    // уходит в мастера. Отказ только мешал: ассистент видел ошибку и бросал
    // задачу, хотя всё нужное для неё уже есть.
    const scope = slotScopeOf(figma.graph, slot.id)
    if (scope === 'page') {
      return {
        error: `Node "${slot.id}" is not inside a component or instance, so there is no master to fill. Place the block directly if this is your own layout.`,
        slotScope: scope
      }
    }

    const target = resolveTarget(figma.graph, args.component_id, args.variant_values)
    if ('error' in target) return target

    // Что уже лежит внутри: человек должен знать, что заменяется.
    const existing = describeSlotContent(figma.graph, slot)

    // Внутри уже нужный компонент — не трогаем.
    if (slotHoldsComponent(figma.graph, slot, existing, target.id)) {
      return {
        slot: slot.id,
        placed: existing[0]?.id ?? null,
        unchanged: true,
        note: 'The slot already holds this component.'
      }
    }

    if (existing.length > 0 && !(args.replace ?? true)) {
      return {
        slot: slot.id,
        filled: false,
        existing,
        note: 'The slot is not empty and replace was false. Reported the content without changing anything.'
      }
    }

    // Место внутри рабочей копии: правим только этот экран.
    if (scope === 'instance') {
      return fillScreenSlot(figma, slot, target, existing, args.variant_values)
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
    if (args.replace ?? true) {
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

/** Что лежит в месте сейчас: id, вид, имя и, для копии, её мастер. */
function describeSlotContent(
  graph: { getNode: (id: string) => SceneNode | undefined },
  slot: SceneNode
): SlotContentEntry[] {
  return slot.childIds.map((childId) => {
    const child = graph.getNode(childId)
    if (!child) return { id: childId, type: 'UNKNOWN', name: '' }
    const master = child.type === 'INSTANCE' ? graph.getNode(child.componentId ?? '') : undefined
    return {
      id: child.id,
      type: child.type,
      name: child.name.trim(),
      ...(master ? { of: master.name.trim() } : {})
    }
  })
}

/**
 * В месте уже нужный компонент — тогда ничего не делаем. Содержимое бывает
 * задано только назначением, без узла в копии: проверяем и его.
 */
function slotHoldsComponent(
  graph: SceneGraph,
  slot: SceneNode,
  existing: SlotContentEntry[],
  componentId: string
): boolean {
  if (getSlotContentId(graph, slot) === componentId) return true
  if (existing.length !== 1 || existing[0].type !== 'INSTANCE') return false
  return graph.getNode(slot.childIds[0])?.componentId === componentId
}

/**
 * Место внутри экрана: назначение ложится на сам экземпляр, поэтому мастер и
 * другие экраны остаются как были. Содержимое ссылается на свойство владельца,
 * так что место всё равно доводим до настоящего.
 */
function fillScreenSlot(
  figma: FigmaAPI,
  slot: SceneNode,
  target: { id: string; name: string },
  existing: SlotContentEntry[],
  variantValues: string | undefined
): Record<string, unknown> | { error: string } {
  const slotProperty = ensureSlotProperty(figma.graph, slot.id)
  const swapped = swapSlotContent(figma.graph, slot, target.id, variantValues)
  if ('error' in swapped) return swapped

  const response: Record<string, unknown> = {
    ...swapped,
    requestedSlot: slot.id,
    component: target.id,
    componentName: target.name.trim(),
    note: 'The block belongs to this screen only: the assignment sits on this instance, so the master and the other screens keep their slots as they were, and the content saves with the file.'
  }
  if (existing.length > 0) {
    response.replaced = existing
    response.removed = existing.map((entry) => entry.id)
  }
  if (slotProperty) {
    response.slotProperty = slotProperty.propertyId
    response.slotIsReal = true
  }
  return response
}

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
