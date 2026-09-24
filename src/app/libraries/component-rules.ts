import { computed } from 'vue'

import {
  readComponentRules,
  releaseOriginalFigArchive,
  writeComponentRules,
  type ComponentRules
} from '@open-pencil/core/tools'

import { useEditorStore, type EditorStore } from '@/app/editor/active-store'

/**
 * Правила компонента: когда брать, что можно менять, что нельзя.
 * Лежат в pluginData компонента — рядом с ним, поэтому едут вместе с файлом
 * и с библиотекой. Читает и пишет их ядро: у панели и у ассистента один
 * источник правды.
 */
export type { ComponentRules }

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

/** Разделы правил по порядку: сначала инструкция, потом запреты и проверки. */
export const RULES_SECTIONS = ['howto', 'use', 'avoid', 'allowed', 'forbidden', 'checks'] as const

export type RulesSection = 'purpose' | (typeof RULES_SECTIONS)[number]

/** Находит компонент-владельца правил для выделенного слоя. */
function resolveOwner(
  graph: ReturnType<typeof useEditorStore>['graph'],
  selected: {
    id: string
    type: string
    name: string
    componentId?: string | null
    parentId?: string | null
  }
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

    const rules = readComponentRules(editor.graph, owner.id)
    if (!rules) return null
    return { componentId: owner.id, name: owner.name, rules, scope: owner.scope }
  })
}

/** Компонент, чьи правила правят: сам компонент, его сет или мастер копии. */
export function rulesOwner(selectedId: string | undefined): { id: string; name: string } | null {
  const editor = useEditorStore()
  if (!selectedId) return null
  const selected = editor.graph.getNode(selectedId)
  if (!selected) return null
  const owner = resolveOwner(editor.graph, selected)
  return owner ? { id: owner.id, name: owner.name } : null
}

/** Правила конкретного компонента — для редактора. */
export function readRules(componentId: string): ComponentRules | null {
  const editor = useEditorStore()
  return readComponentRules(editor.graph, componentId)
}

/**
 * Записывает правила компонента с отменой.
 *
 * Правка живёт в pluginData, поэтому вместо снимка страницы пишем обратное
 * действие: снятие архива делает документ изменённым, и правила переживают
 * сохранение и перезагрузку.
 */
export function writeRules(store: EditorStore, componentId: string, rules: ComponentRules): void {
  const before = readComponentRules(store.graph, componentId)
  const apply = (value: ComponentRules | null) => {
    writeComponentRules(store.graph, componentId, value ?? {})
    releaseOriginalFigArchive(store.graph)
    store.requestRender()
  }

  apply(rules)
  store.pushUndoEntry({
    label: 'Правила компонента',
    forward: () => apply(rules),
    inverse: () => apply(before)
  })
}
