import { useVueTable, getCoreRowModel } from '@tanstack/vue-table'
import { computed, ref, watch, type Component } from 'vue'

import { useVariablesDialogState } from '#vue/variables/dialog/use'
import { buildVariableRows, groupPathsOf } from '#vue/variables/table/grouping'
import { useVariablesTable } from '#vue/variables/table/use'

/**
 * Composes variables dialog state, table columns, and TanStack table wiring
 * into a single higher-level variables editor API.
 *
 * Строки таблицы — не только переменные, но и группы пути: имя переменной это
 * путь (`accordion-status/background/default`), и его сворачивают, чтобы
 * длинный список читался.
 */
export function useVariablesEditor(options: {
  /** Component used for color variable editing. */
  colorInput: Component
  /** Icon map keyed by variable resolved type. */
  icons: Record<string, Component>
  /** Fallback icon when no specific icon matches a variable type. */
  fallbackIcon: Component
  /** Icon used for destructive remove actions. */
  deleteIcon: Component
  /** Icon of a path group row. */
  groupIcon: Component
  /** Chevron of a collapsible group row. */
  chevronIcon: Component
}) {
  const ctx = useVariablesDialogState()

  /** Раскрытые группы пути. По умолчанию всё свёрнуто, как в Figma. */
  const expandedGroups = ref<ReadonlySet<string>>(new Set<string>())

  function toggleGroup(path: string) {
    const next = new Set(expandedGroups.value)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    expandedGroups.value = next
  }

  // Смена коллекции — снова всё свёрнуто.
  watch(
    () => ctx.activeCollectionId.value,
    () => {
      expandedGroups.value = new Set<string>()
    }
  )

  // Поиск показывает найденное: раскрываем группы, в которых есть совпадения.
  watch(
    () => ctx.searchTerm.value,
    (term) => {
      if (!term.trim()) return
      expandedGroups.value = groupPathsOf(ctx.variables.value)
    }
  )

  const rows = computed(() => buildVariableRows(ctx.variables.value, expandedGroups.value))

  const { columns } = useVariablesTable({
    activeModes: ctx.activeModes,
    formatModeValue: ctx.formatModeValue,
    parseVariableValue: ctx.parseVariableValue,
    shortName: ctx.shortName,
    renameVariable: ctx.renameVariable,
    updateVariableValue: ctx.updateVariableValue,
    removeVariable: ctx.removeVariable,
    toggleGroup,
    ColorInput: options.colorInput,
    icons: options.icons,
    fallbackIcon: options.fallbackIcon,
    deleteIcon: options.deleteIcon,
    groupIcon: options.groupIcon,
    chevronIcon: options.chevronIcon
  })

  const table = useVueTable({
    get data() {
      return rows.value
    },
    get columns() {
      return columns.value
    },
    columnResizeMode: 'onChange',
    getCoreRowModel: getCoreRowModel(),
    defaultColumn: {
      minSize: 60,
      maxSize: 800
    },
    getRowId: (row) => row.id
  })

  const hasCollections = computed(() => ctx.collections.value.length > 0)

  return {
    ...ctx,
    columns,
    table,
    hasCollections,
    expandedGroups,
    toggleGroup
  }
}
