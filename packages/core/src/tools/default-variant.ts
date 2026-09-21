/**
 * Базовый вариант компонента.
 *
 * У сета вариантов нет понятия «по умолчанию»: вставить можно только
 * конкретный вариант, поэтому при вставке выбирается случайный из десятков.
 * Здесь отмечаем у сета один вариант как базовый — его берут панель ассетов
 * и ассистент, если контекст не говорит иного.
 *
 * Хранится в pluginData сета: `{ variantId, variantName }`.
 */
import type { SceneGraph } from '@open-pencil/scene-graph'

export const RULES_PLUGIN_ID = 'norka.design-system'
export const DEFAULT_VARIANT_KEY = 'default-variant'

export interface DefaultVariant {
  variantId: string
  variantName: string
}

interface NodeWithPluginData {
  pluginData?: readonly { pluginId: string; key: string; value: string }[]
}

function read(graph: SceneGraph, setId: string): DefaultVariant | null {
  const set = graph.getNode(setId)
  if (!set) return null
  const entry = (set as unknown as NodeWithPluginData).pluginData?.find(
    (item) => item.pluginId === RULES_PLUGIN_ID && item.key === DEFAULT_VARIANT_KEY
  )
  if (!entry) return null
  try {
    const parsed = JSON.parse(entry.value) as Partial<DefaultVariant>
    if (typeof parsed.variantId !== 'string') return null
    // Вариант мог исчезнуть — тогда базового нет.
    if (!graph.getNode(parsed.variantId)) return null
    return {
      variantId: parsed.variantId,
      variantName: typeof parsed.variantName === 'string' ? parsed.variantName : parsed.variantId
    }
  } catch {
    return null
  }
}

/**
 * Вариант, который берём по умолчанию.
 *
 * Порядок: помеченный базовый → вариант `Property 1=Default`, `State=Default`
 * или `Size=16` → первый вариант. Так панель и ассистент всегда получают
 * осмысленный выбор, даже если базовый не помечен.
 */
export function resolveDefaultVariant(
  graph: SceneGraph,
  componentId: string
): { variantId: string; variantName: string; source: 'marked' | 'guessed' } | null {
  const node = graph.getNode(componentId)
  if (!node) return null

  // Если это уже вариант — вернём как есть.
  const parent = node.parentId ? graph.getNode(node.parentId) : null
  if (parent?.type === 'COMPONENT_SET' && node.type === 'COMPONENT') {
    return { variantId: node.id, variantName: node.name, source: 'marked' }
  }

  // Это сет: ищем базовый.
  if (node.type === 'COMPONENT_SET') {
    const marked = read(graph, node.id)
    if (marked) return { ...marked, source: 'marked' }

    const guesses = [/^state=default/i, /^property 1=default/i, /size=16/i, /^state=hover/i]
    for (const pattern of guesses) {
      const match = node.childIds
        .map((id) => graph.getNode(id))
        .find((variant) => variant && pattern.test(variant.name.trim()))
      if (match) return { variantId: match.id, variantName: match.name, source: 'guessed' }
    }

    const first = node.childIds.map((id) => graph.getNode(id)).find(Boolean)
    if (first) return { variantId: first.id, variantName: first.name, source: 'guessed' }
  }

  return null
}

/** Помечает вариант базовым у сета. */
export function markDefaultVariant(
  graph: SceneGraph,
  setId: string,
  variantId: string
): boolean {
  const set = graph.getNode(setId)
  const variant = graph.getNode(variantId)
  if (!set || set.type !== 'COMPONENT_SET' || !variant) return false
  if (!set.childIds.includes(variantId)) return false

  const entry = {
    pluginId: RULES_PLUGIN_ID,
    key: DEFAULT_VARIANT_KEY,
    value: JSON.stringify({ variantId, variantName: variant.name })
  }
  const rest = ((set as unknown as NodeWithPluginData).pluginData ?? []).filter(
    (item) => !(item.pluginId === RULES_PLUGIN_ID && item.key === DEFAULT_VARIANT_KEY)
  )
  graph.updateNode(setId, { pluginData: [...rest, entry] })
  return true
}
