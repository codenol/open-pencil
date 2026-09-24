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
  /** Порядок сборки: шаги, по которым компонент собирают. */
  howto?: string[]
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
    for (const key of ['howto', 'use', 'avoid', 'allowed', 'forbidden', 'checks'] as const) {
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

/**
 * Записывает правила компонента.
 *
 * Правила варианта живут на его сете — как и при чтении: у варианта своего
 * набора правил не бывает. Пустые правила снимают пометку целиком, чтобы
 * «правил нет» и «правила из одних пустых строк» не различались.
 */
export function writeComponentRules(
  graph: SceneGraph,
  componentId: string,
  rules: ComponentRules
): boolean {
  const node = graph.getNode(componentId)
  if (!node) return false

  const parent = node.parentId ? graph.getNode(node.parentId) : null
  const target =
    node.type === 'COMPONENT' && parent?.type === 'COMPONENT_SET' ? parent : node
  if (target.type !== 'COMPONENT' && target.type !== 'COMPONENT_SET') return false

  const cleaned = cleanRules(rules)
  const rest = target.pluginData.filter(
    (item) => !(item.pluginId === RULES_PLUGIN_ID && item.key === RULES_KEY)
  )
  if (!cleaned) {
    graph.updateNode(target.id, { pluginData: rest })
    return true
  }
  graph.updateNode(target.id, {
    pluginData: [
      ...rest,
      { pluginId: RULES_PLUGIN_ID, key: RULES_KEY, value: JSON.stringify(cleaned) }
    ]
  })
  return true
}

/** Оставляет только непустые разделы; пустой набор — это отсутствие правил. */
function cleanRules(rules: ComponentRules): ComponentRules | null {
  const cleaned: ComponentRules = {}
  if (typeof rules.purpose === 'string' && rules.purpose.trim() !== '') {
    cleaned.purpose = rules.purpose.trim()
  }
  for (const key of ['howto', 'use', 'avoid', 'allowed', 'forbidden', 'checks'] as const) {
    const items = (rules[key] ?? []).map((item) => item.trim()).filter((item) => item !== '')
    if (items.length > 0) cleaned[key] = items
  }
  return Object.keys(cleaned).length > 0 ? cleaned : null
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
