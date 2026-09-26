import type { ColumnDef } from '@tanstack/vue-table'
import { EditableArea, EditableInput, EditablePreview, EditableRoot } from 'reka-ui'
import { h, type Component, type ComputedRef } from 'vue'

import type { Variable, VariableValue } from '@open-pencil/scene-graph'
import type { Color } from '@open-pencil/scene-graph/primitives'

import { leafNameOf, type VariableRow } from '#vue/variables/table/grouping'

export interface VariablesTableOptions {
  activeModes: ComputedRef<{ modeId: string; name: string }[]>
  formatModeValue: (variable: Variable, modeId: string) => string
  parseVariableValue: (variable: Variable, raw: string) => VariableValue | undefined
  shortName: (variable: Variable) => string
  renameVariable: (id: string, newName: string) => void
  updateVariableValue: (id: string, modeId: string, value: VariableValue) => void
  removeVariable: (id: string) => void
  /** Раскрыть или свернуть группу пути. */
  toggleGroup: (path: string) => void
  ColorInput: Component
  icons: Record<string, Component>
  fallbackIcon: Component
  deleteIcon: Component
  /** Папка у строки-группы. */
  groupIcon: Component
  /** Стрелка раскрытия группы. */
  chevronIcon: Component
}

/** Отступ строки по глубине группы. */
function indentStyle(depth: number) {
  return { paddingLeft: `${depth * 12}px` }
}

function commitNameEdit(options: VariablesTableOptions, variable: Variable, newName: string) {
  if (!newName) return
  // Правим только последний сегмент: путь группы остаётся на месте.
  const path = variable.name.includes('/')
    ? `${variable.name.slice(0, variable.name.lastIndexOf('/'))}/${newName}`
    : newName
  if (path !== variable.name) options.renameVariable(variable.id, path)
}

function commitValueEdit(
  options: VariablesTableOptions,
  variable: Variable,
  modeId: string,
  newValue: string
) {
  const parsed = options.parseVariableValue(variable, newValue)
  if (parsed !== undefined) {
    options.updateVariableValue(variable.id, modeId, parsed)
  }
}

/** Строка группы: раскрывается по нажатию, значения у неё не показываем. */
function createGroupNameCell(options: VariablesTableOptions, row: VariableRow) {
  if (row.kind !== 'group') return null
  return h(
    'button',
    {
      type: 'button',
      class:
        'flex w-full cursor-pointer items-center gap-1.5 border-none bg-transparent text-left',
      style: indentStyle(row.depth),
      'aria-expanded': row.expanded,
      'data-group-path': row.path,
      onClick: () => options.toggleGroup(row.path)
    },
    [
      h(options.chevronIcon, {
        class: `size-3.5 shrink-0 text-muted transition-transform ${row.expanded ? 'rotate-90' : ''}`
      }),
      h(options.groupIcon, { class: 'size-3.5 shrink-0 text-muted' }),
      h('span', { class: 'min-w-0 truncate text-xs text-surface' }, row.name),
      h('span', { class: 'ml-1 shrink-0 text-[10px] text-muted' }, String(row.count))
    ]
  )
}

function createVariableNameColumn(options: VariablesTableOptions): ColumnDef<VariableRow> {
  return {
    id: 'name',
    header: 'Name',
    size: 260,
    minSize: 140,
    maxSize: 400,
    cell: ({ row }) => {
      const group = createGroupNameCell(options, row.original)
      if (group) return group
      if (row.original.kind !== 'variable') return null

      const variable = row.original.variable
      const iconClass = 'size-3.5 shrink-0 text-muted'
      const iconComponent = options.icons[variable.type] ?? options.fallbackIcon
      const icon = h(iconComponent, { class: iconClass })

      return h('div', { class: 'flex items-center gap-2', style: indentStyle(row.original.depth) }, [
        icon,
        h(
          EditableRoot,
          {
            defaultValue: leafNameOf(variable.name),
            class: 'min-w-0 flex-1',
            onSubmit: (value: string | null | undefined) =>
              value && commitNameEdit(options, variable, value)
          },
          () =>
            h(EditableArea, { class: 'flex' }, () => [
              h(EditablePreview, {
                class: 'min-w-0 flex-1 cursor-text truncate text-xs text-surface'
              }),
              h(EditableInput, {
                class:
                  'min-w-0 flex-1 rounded border border-border bg-surface/10 px-1 py-0.5 text-xs text-surface outline-none'
              })
            ])
        )
      ])
    }
  }
}

function createVariableModeColumns(options: VariablesTableOptions): ColumnDef<VariableRow>[] {
  return options.activeModes.value.map((mode) => ({
    id: `mode-${mode.modeId}`,
    header: mode.name,
    size: 200,
    minSize: 120,
    maxSize: 500,
    cell: ({ row }) => {
      if (row.original.kind !== 'variable') return null
      const variable = row.original.variable
      const value = variable.valuesByMode[mode.modeId]

      if (variable.type === 'COLOR' && value && typeof value === 'object' && 'r' in value) {
        return h(options.ColorInput, {
          color: value,
          onUpdate: (color: Color) => options.updateVariableValue(variable.id, mode.modeId, color)
        })
      }

      return h(
        EditableRoot,
        {
          defaultValue: options.formatModeValue(variable, mode.modeId),
          class: 'min-w-0 flex-1',
          onSubmit: (submitted: string | null | undefined) =>
            submitted && commitValueEdit(options, variable, mode.modeId, submitted)
        },
        () =>
          h(EditableArea, { class: 'flex' }, () => [
            h(EditablePreview, {
              class: 'min-w-0 flex-1 cursor-text truncate font-mono text-xs text-muted'
            }),
            h(EditableInput, {
              class:
                'min-w-0 flex-1 rounded border border-border bg-surface/10 px-1 py-0.5 font-mono text-xs text-surface outline-none'
            })
          ])
      )
    }
  }))
}

function createDeleteColumn(options: VariablesTableOptions): ColumnDef<VariableRow> {
  return {
    id: 'actions',
    header: '',
    size: 36,
    minSize: 36,
    maxSize: 36,
    enableResizing: false,
    cell: ({ row }) => {
      if (row.original.kind !== 'variable') return null
      return h(
        'button',
        {
          class:
            'flex size-5 cursor-pointer items-center justify-center rounded border-none bg-transparent text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-surface',
          onClick: () => options.removeVariable(row.original.kind === 'variable' ? row.original.variable.id : '')
        },
        h(options.deleteIcon, { class: 'size-3' })
      )
    }
  }
}

export function createVariableColumns(options: VariablesTableOptions): ColumnDef<VariableRow>[] {
  return [
    createVariableNameColumn(options),
    ...createVariableModeColumns(options),
    createDeleteColumn(options)
  ]
}
