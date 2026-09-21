/**
 * Правила компонентов — чтение и проверка нарушений.
 *
 * Правила лежат в pluginData компонента: закреплены за конкретным компонентом
 * и едут вместе с ним. Ассистент получает их в двух точках — при поиске
 * (кратко) и при вставке (полностью), — а затем проверяет результат по ним.
 */
import type { SceneGraph } from '@open-pencil/scene-graph'

export const RULES_PLUGIN_ID = 'norka.design-system'
export const RULES_KEY = 'component-rules'

export interface ComponentRules {
  purpose?: string
  use?: string[]
  avoid?: string[]
  allowed?: string[]
  forbidden?: string[]
  checks?: string[]
}

interface NodeWithPluginData {
  pluginData?: { pluginId: string; key: string; value: string }[]
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function parse(value: string): ComponentRules | null {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object') return null
    const rules: ComponentRules = {}
    if (typeof parsed.purpose === 'string') rules.purpose = parsed.purpose
    for (const key of ['use', 'avoid', 'allowed', 'forbidden', 'checks'] as const) {
      if (isStringArray(parsed[key])) rules[key] = parsed[key]
    }
    return rules
  } catch {
    return null
  }
}

function rulesOf(node: NodeWithPluginData | null | undefined): ComponentRules | null {
  const entry = node?.pluginData?.find(
    (item) => item.pluginId === RULES_PLUGIN_ID && item.key === RULES_KEY
  )
  return entry ? parse(entry.value) : null
}

/**
 * Полные правила компонента. Если правила лежат на сете вариантов — берём их.
 */
export function readComponentRules(
  graph: SceneGraph,
  componentId: string
): ComponentRules | null {
  const node = graph.getNode(componentId)
  if (!node) return null

  const own = rulesOf(node)
  if (own) return own

  if (node.parentId) {
    const parent = graph.getNode(node.parentId)
    if (parent?.type === 'COMPONENT_SET') return rulesOf(parent)
  }
  return null
}

/** Один компонент с правилами и понятным «кто это». */
export interface RulesViolationTarget {
  componentId: string
  name: string
  rules: ComponentRules
}

/**
 * Компонент, по правилам которого нужно проверить узел: сам компонент,
 * его мастер (если это инстанс) или сет вариантов.
 */
export function resolveRulesTargetForNode(
  graph: SceneGraph,
  nodeId: string
): RulesViolationTarget | null {
  const node = graph.getNode(nodeId)
  if (!node) return null

  const candidates: string[] = []
  if (node.type === 'INSTANCE' && node.componentId) candidates.push(node.componentId)
  if (node.type === 'COMPONENT') candidates.push(node.id)
  if (node.type === 'COMPONENT_SET') candidates.push(node.id)

  for (const id of candidates) {
    const rules = readComponentRules(graph, id)
    if (!rules) continue
    const target = graph.getNode(id)
    if (!target) continue
    const parent = target.parentId ? graph.getNode(target.parentId) : null
    const name = parent?.type === 'COMPONENT_SET' ? parent.name : target.name
    return { componentId: id, name, rules }
  }
  return null
}
