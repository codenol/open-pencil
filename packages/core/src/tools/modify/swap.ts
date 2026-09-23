import * as v from 'valibot'

import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { nodeIdInput } from '#core/tools/input'
import { defineTool } from '#core/tools/schema'
import { releaseOriginalFigArchive } from '#core/kiwi/fig/session/original-archive'

/**
 * Замена компонента у экземпляра — «swap», как в Figma.
 *
 * Без этого иконку нельзя было подменить: ассистент пытался подогнать её
 * масштабированием, путался в порядке операций и подставлял вектор напрямую,
 * теряя связь с библиотекой. Замена решает это одним действием: экземпляр
 * начинает ссылаться на другой компонент, содержимое и размеры приходят
 * из него.
 *
 * Если у цели есть свойства варианта, замену можно уточнить: `variant_values`
 * подбирает вариант сета по указанным значениям. Так иконка меняется сразу
 * в нужном размере — «взять `wine` размера 16» вместо ручной подгонки.
 */
export const swapComponent = defineTool({
  name: 'swap_component',
  description:
    'Swap the component of an existing instance, like Swap in Figma. Use it to change an icon inside a button or field, or to replace one component with another while keeping the instance position and overrides. Pass variant_values to pick a specific variant of a component set (for example {"Size": "16"}). Do not resize or redraw a glyph by hand — swap it.',
  execution: { kind: 'sync', mutation: 'properties' },
  input: v.object({
    id: nodeIdInput,
    component_id: v.pipe(v.string(), v.description('Component or component set node ID to swap to')),
    variant_values: v.optional(
      v.pipe(
        v.string(),
        v.description('Optional JSON object of variant property values, e.g. {"Size":"16"}')
      )
    )
  }),
  execute: (figma, args) => {
    const instance = figma.graph.getNode(args.id)
    if (!instance) return { error: `Node "${args.id}" not found` }
    if (instance.type !== 'INSTANCE') {
      return { error: `Node "${args.id}" is ${instance.type}, not an instance — swap needs an instance` }
    }

    const resolved = resolveSwapTarget(figma.graph, args.component_id, args.variant_values)
    if ('error' in resolved) return resolved

    const previousName = instance.name
    figma.graph.swapInstanceComponent(args.id, resolved.componentId)
    // Своп меняет ссылку узла на компонент, а экспорт отдаёт исходный архив
    // файла, пока тот считается годным. Без сброса своп живёт до перезагрузки:
    // на канвасе видно, в файл не попадает.
    releaseOriginalFigArchive(figma.graph)

    const updated = figma.graph.getNode(args.id)
    return {
      id: args.id,
      componentId: resolved.componentId,
      componentName: resolved.componentName,
      ...(resolved.variantName ? { variantName: resolved.variantName } : {}),
      // Имя могло измениться вместе с компонентом — говорим об этом явно.
      ...(updated && updated.name !== previousName ? { name: updated.name } : {})
    }
  }
})

/**
 * Куда менять: сам компонент или нужный вариант сета.
 *
 * Если заданы значения вариантов, ищем вариант сета, который им отвечает.
 * Иначе, если передан сет, берём его базовый вариант — у сета нельзя взять
 * «компонент вообще», вставить можно только конкретный вариант.
 */
function resolveSwapTarget(
  graph: SceneGraph,
  componentId: string,
  variantValues?: string
):
  | { componentId: string; componentName: string; variantName?: string }
  | { error: string } {
  const target = graph.getNode(componentId)
  if (!target) return { error: `Component "${componentId}" not found` }

  if (target.type === 'COMPONENT') {
    return { componentId: target.id, componentName: target.name }
  }
  if (target.type !== 'COMPONENT_SET') {
    return { error: `Node "${componentId}" is ${target.type}, not a component or component set` }
  }

  let wanted: Record<string, string> | null = null
  if (variantValues) {
    try {
      const parsed = JSON.parse(variantValues) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { error: 'variant_values must be a JSON object, e.g. {"Size":"16"}' }
      }
      wanted = Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [key, String(value)])
      )
    } catch {
      return { error: 'variant_values is not valid JSON' }
    }
  }

  const variant = findVariant(graph, target, wanted)
  if (!variant) {
    const available = target.childIds
      .map((id) => graph.getNode(id)?.name)
      .filter(Boolean)
      .slice(0, 12)
    return {
      error: `No variant of "${target.name}" matches ${JSON.stringify(wanted)}. Available: ${available.join('; ')}`
    }
  }

  return {
    componentId: variant.id,
    componentName: target.name,
    variantName: variant.name
  }
}

/**
 * Ищет вариант сета по значениям свойств.
 *
 * Без уточнений берём базовый: первый вариант, у которого значения совпадают
 * с наиболее частыми у сета. Так «замени иконку» даёт осмысленный размер,
 * а не случайный из десятков.
 */
function findVariant(
  graph: SceneGraph,
  set: SceneNode,
  wanted: Record<string, string> | null
): SceneNode | null {
  const variants = set.childIds
    .map((id) => graph.getNode(id))
    .filter((node): node is SceneNode => node?.type === 'COMPONENT')
  if (variants.length === 0) return null

  if (wanted && Object.keys(wanted).length > 0) {
    return (
      variants.find((variant) =>
        Object.entries(wanted).every(([key, value]) => {
          const actual = variant.componentPropertyValues?.[key]
          return actual !== undefined && actual.toLowerCase() === value.toLowerCase()
        })
      ) ?? null
    )
  }

  // Без уточнений: вариант с самыми частыми значениями свойств.
  const tally = new Map<string, Map<string, number>>()
  for (const variant of variants) {
    for (const [key, value] of Object.entries(variant.componentPropertyValues ?? {})) {
      if (!value) continue
      const bucket = tally.get(key) ?? new Map<string, number>()
      bucket.set(value, (bucket.get(value) ?? 0) + 1)
      tally.set(key, bucket)
    }
  }
  return (
    variants.find((variant) =>
      Object.entries(variant.componentPropertyValues ?? {}).every(([key, value]) => {
        if (!value) return true
        const bucket = tally.get(key)
        if (!bucket) return true
        const best = [...bucket.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
        return best === undefined || value === best
      })
    ) ?? variants[0]
  )
}

/** Размер экземпляра после замены: нужен, чтобы отчитаться честно. */
export const swapComponentSize = defineTool({
  name: 'swap_component_size',
  description: 'Read the size of an instance after a swap, to confirm the new component fits.',
  execution: { kind: 'sync', mutation: 'none' },
  input: v.object({ id: nodeIdInput }),
  execute: (figma, { id }) => {
    const node = figma.getNodeById(id)
    if (!node) return { error: `Node "${id}" not found` }
    return {
      id,
      width: Math.round(node.width),
      height: Math.round(node.height)
    }
  }
})
