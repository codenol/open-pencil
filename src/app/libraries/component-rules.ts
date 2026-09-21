import { computed } from 'vue'

import { useEditorStore } from '@/app/editor/active-store'

/**
 * Правила компонента: когда брать, что можно менять, что нельзя.
 * Лежат в pluginData компонента — рядом с ним, поэтому едут вместе с файлом
 * и с библиотекой. Формат один на все компоненты.
 */
const PLUGIN_ID = 'norka.design-system'
const RULES_KEY = 'component-rules'

export interface ComponentRules {
  purpose?: string
  use?: string[]
  avoid?: string[]
  allowed?: string[]
  forbidden?: string[]
  checks?: string[]
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function parseRules(raw: string): ComponentRules | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
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

/**
 * Правила есть только у компонентов: у обычного слоя их не бывает.
 * Инстанс показывает правила своего мастера — читать их можно, менять нельзя.
 */
export type RulesScope = 'component' | 'instance'

export interface ComponentRulesEntry {
  /** Компонент, за которым закреплены правила. */
  componentId: string
  name: string
  rules: ComponentRules
  /** Смотрим правила компонента напрямую или через инстанс. */
  scope: RulesScope
}

/** Находит компонент-владельца правил для выделенного слоя. */
function resolveOwner(
  graph: ReturnType<typeof useEditorStore>['graph'],
  selected: { id: string; type: string; name: string; componentId?: string | null; parentId?: string | null }
): { id: string; name: string; scope: RulesScope } | null {
  // Выделен сам компонент — правила его.
  if (selected.type === 'COMPONENT') {
    const parent = selected.parentId ? graph.getNode(selected.parentId) : null
    const name = parent?.type === 'COMPONENT_SET' ? parent.name.trim() : selected.name
    return { id: selected.id, name, scope: 'component' }
  }

  // Выделен сет вариантов — правила лежат на его вариантах, берём сам сет.
  if (selected.type === 'COMPONENT_SET') {
    return { id: selected.id, name: selected.name, scope: 'component' }
  }

  // Выделен инстанс — показываем правила мастера.
  if (selected.type === 'INSTANCE' && selected.componentId) {
    const master = graph.getNode(selected.componentId)
    if (!master) return null
    const parent = master.parentId ? graph.getNode(master.parentId) : null
    const name = parent?.type === 'COMPONENT_SET' ? parent.name.trim() : master.name
    return { id: master.id, name, scope: 'instance' }
  }

  return null
}

/**
 * Достаёт правила выделенного компонента. Для инстанса — правила его мастера.
 * Возвращает null, если выделено не компонент либо правил нет.
 */
export function useComponentRules() {
  const editor = useEditorStore()

  return computed<ComponentRulesEntry | null>(() => {
    // Пересчитываем при смене выделения и при правках документа.
    void editor.state.selectedIds
    void editor.state.sceneVersion

    const selected = [...editor.state.selectedIds]
      .map((id) => editor.graph.getNode(id))
      .find(Boolean)
    if (!selected) return null

    const owner = resolveOwner(editor.graph, selected)
    if (!owner) return null

    // Ищем правила на самом компоненте, затем на сете, если компонент — вариант.
    const candidates = [editor.graph.getNode(owner.id)].filter(Boolean)
    const ownerNode = editor.graph.getNode(owner.id)
    if (ownerNode?.parentId) {
      const parent = editor.graph.getNode(ownerNode.parentId)
      if (parent?.type === 'COMPONENT_SET') candidates.push(parent)
    }

    for (const node of candidates) {
      if (!node) continue
      const entry = node.pluginData?.find(
        (item) => item.pluginId === PLUGIN_ID && item.key === RULES_KEY
      )
      if (!entry) continue
      const rules = parseRules(entry.value)
      if (rules) return { componentId: owner.id, name: owner.name, rules, scope: owner.scope }
    }
    return null
  })
}
