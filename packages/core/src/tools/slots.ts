import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

/**
 * Слот — именованный контейнер, который наполняется готовым блоком.
 *
 * Разметка живёт в pluginData узла: `Main container` в мастере `Layout` — слот,
 * как и `Slot`, `Top slot`, `statuses slot` в других мастерах. Пометка едет
 * с компонентом в файле и библиотеке.
 *
 * Зачем метка: узлы, добавленные прямо в инстанс, на экране видны, но в файл
 * не пишутся — работа теряется после сохранения. Слот надо занимать блоком,
 * собранным как компонент. Метка говорит об этом и человеку, и ассистенту.
 */

const PLUGIN_ID = 'norka.design-system'
const SLOT_KEY = 'slot'

/** Пометка слота у узла, если он слот. */
export function readSlot(
  node: { pluginData?: Array<{ pluginId: string; key: string; value: string }> } | undefined
): { role: 'slot' } | null {
  if (!node) return null
  const entry = node.pluginData?.find(
    (item) => item.pluginId === PLUGIN_ID && item.key === SLOT_KEY
  )
  if (!entry) return null
  try {
    const parsed = JSON.parse(entry.value) as { role?: unknown }
    return parsed.role === 'slot' ? { role: 'slot' } : null
  } catch {
    return null
  }
}

/**
 * Слоты внутри узла — прямые дети, помеченные меткой.
 *
 * Нужны в чтении узла: увидев слот, ассистент должен понять, что наполнять
 * его надо блоком-компонентом, а не узлами напрямую.
 */
export function childSlots(
  graph: SceneGraph,
  nodeId: string
): Array<{ id: string; name: string; filled: boolean }> {
  const node = graph.getNode(nodeId)
  if (!node) return []
  const result: Array<{ id: string; name: string; filled: boolean }> = []
  for (const childId of node.childIds) {
    const child = graph.getNode(childId)
    if (!child || readSlot(child) === null) continue
    result.push({
      id: child.id,
      name: child.name.trim(),
      // Занят ли слот: внутри что-то есть.
      filled: child.childIds.length > 0
    })
  }
  return result
}

/** Что сказать ассистенту про слот. */
export const SLOT_HINT =
  'This is a slot: fill it with a block built as a component, then swap the slot onto that component. Nodes added straight into a slot in an instance show on screen but are not saved.'
