import { isEqual } from 'es-toolkit'

import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

/**
 * Узкий снимок для точечной правки.
 *
 * Атомарный инструмент меняет свойства нескольких узлов и не трогает
 * структуру. Общий снимок графа делал копию всего документа — на дизайн-системе
 * это десятки тысяч объектов ради изменения заливки, поэтому для больших
 * документов правки просто запрещались.
 *
 * Здесь снимаем только те узлы, которые инструмент собирается менять.
 * Структуру это не ослабляет: инструмент и так не имеет права менять
 * иерархию, а мы это проверяем по факту.
 */
export interface ScopedCheckpoint {
  /** Идентификаторы узлов, попавших в снимок. */
  ids: string[]
  /** Прежние значения свойств по каждому узлу. */
  before: Map<string, Partial<SceneNode>>
  /** Изменилась ли структура документа. */
  structureIntact: () => boolean
  /** Возвращает узлы к прежним значениям. */
  restore: () => void
}

/**
 * Безопасная копия значения.
 *
 * `structuredClone` падает на символах и функциях, а в свойствах узла
 * встречаются служебные значения вроде `Symbol(mixed)`. Копируем только
 * то, что действительно копируется, остальное переносим по ссылке —
 * для отката этого достаточно.
 */
function safeClone<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  try {
    return structuredClone(value)
  } catch {
    return value
  }
}

/** Поля, которые описывают структуру, а не свойства. */
const STRUCTURE_FIELDS = ['id', 'type', 'parentId', 'childIds', 'componentId'] as const

/**
 * Снимает узлы, которые инструмент собирается тронуть.
 *
 * `candidateIds` — что инструмент назвал целью. Если список пуст (инструмент
 * работает по выделению), снимаем выделенные узлы.
 */
export function captureScopedCheckpoint(
  graph: SceneGraph,
  candidateIds: Iterable<string>
): ScopedCheckpoint {
  const ids = [...candidateIds].filter((id) => graph.getNode(id) !== undefined)
  const before = new Map<string, Partial<SceneNode>>()
  const structure = new Map<string, string>()

  for (const id of ids) {
    const node = graph.getNode(id)
    if (!node) continue
    // Копия свойств без структуры: её изменение всё равно недопустимо.
    const values = safeClone({ ...node }) as Partial<SceneNode>
    for (const field of STRUCTURE_FIELDS) Reflect.deleteProperty(values, field)
    before.set(id, values)
    structure.set(id, structureKey(node))
  }

  const nodeCount = graph.nodes.size
  const variableCount = graph.variables.size

  return {
    ids,
    before,
    structureIntact: () =>
      graph.nodes.size === nodeCount &&
      graph.variables.size === variableCount &&
      ids.every((id) => {
        const node = graph.getNode(id)
        if (!node) return false
        return structure.get(id) === structureKey(node)
      }),
    restore: () => {
      graph.withLayoutMutations(() => {
        for (const [id, values] of before) {
          const node = graph.getNode(id)
          if (!node) continue
          // Убираем поля, которых до правки не было, и возвращаем прежние.
          for (const key of Object.keys(node) as (keyof SceneNode)[]) {
            if (STRUCTURE_FIELDS.includes(key as (typeof STRUCTURE_FIELDS)[number])) continue
            if (!(key in values)) Reflect.deleteProperty(node, key)
          }
          Object.assign(node, safeClone(values))
        }
      })
    }
  }
}

/** Отпечаток структуры узла: по нему видно, что иерархия не поехала. */
function structureKey(node: SceneNode): string {
  return [
    node.id,
    node.type,
    node.parentId ?? '',
    node.componentId ?? '',
    node.childIds.join(',')
  ].join('|')
}

/** Есть ли смысл в узком снимке: изменилось ли что-то, кроме структуры. */
export function scopedChanges(
  graph: SceneGraph,
  checkpoint: ScopedCheckpoint
): Array<{ id: string; before: Partial<SceneNode>; after: Partial<SceneNode> }> {
  const result: Array<{ id: string; before: Partial<SceneNode>; after: Partial<SceneNode> }> = []
  for (const [id, previous] of checkpoint.before) {
    const node = graph.getNode(id)
    if (!node) continue
    const after: Partial<SceneNode> = {}
    const changedBefore: Partial<SceneNode> = {}
    const keys = new Set([...Object.keys(previous), ...Object.keys(node)] as (keyof SceneNode)[])
    for (const key of keys) {
      if (STRUCTURE_FIELDS.includes(key as (typeof STRUCTURE_FIELDS)[number])) continue
      const current = node[key]
      const before = previous[key]
      if (isEqual(before, current)) continue
      ;(after as Record<string, unknown>)[key] = safeClone(current)
      ;(changedBefore as Record<string, unknown>)[key] = safeClone(before)
    }
    if (Object.keys(after).length > 0) result.push({ id, before: changedBefore, after })
  }
  return result
}
