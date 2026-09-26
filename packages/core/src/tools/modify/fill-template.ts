import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'
import { setInstanceOverride } from '@open-pencil/scene-graph'

import * as v from 'valibot'

import type { FigmaAPI } from '#core/figma-api'
import { nodeIdInput, toolNumber } from '#core/tools/input'
import { defineTool } from '#core/tools/schema'
import {
  findVariantByValues,
  resolveScreenTemplate,
  variantForSense,
  type ResolvedScreenTemplate,
  type ScreenTemplateVariantSpec
} from '#core/tools/screen-template'

const columnInput = v.object({
  index: toolNumber(v.pipe(v.number(), v.description('Column number as the template lists it'))),
  title: v.optional(v.pipe(v.string(), v.description('New column title'))),
  field: v.optional(v.pipe(v.string(), v.description('Row field this column shows')))
})

const rowInput = v.record(
  v.string(),
  v.pipe(v.string(), v.description('Field value. For a status, badge or checkbox column write «смысл|подпись»'))
)

/**
 * Наполнение экрана данными.
 *
 * Копия эталона — это каркас с пустыми местами: строки, ячейки и подписи
 * в ней ещё от образца. Наполнять по ячейке нельзя: на экран уходят сотни
 * вызовов, и работа растягивается на час. Этот инструмент делает то же самое
 * одним действием — переписывает колонки, повторяет ряд-образец до нужного
 * числа записей, ставит тексты, варианты статусов и бейджей.
 */
export const fillScreenTemplate = defineTool({
  name: 'fill_screen_template',
  description:
    'Fill a screen built from a template with data in one call. Give the rows as objects keyed by the template fields (the same keys get_screen_template returns for the columns), and optionally rename columns and set the screen title. Text columns take the value as text; status and badge columns take a meaning from the template dictionary, or «meaning|caption» to set the caption too; checkbox columns take yes, no or indeterminate. The row pattern is repeated or trimmed to match the number of rows you pass. Renaming columns does not change their widths: keep their sum inside the stage contentWidth get_screen_template reports, or the table runs past the frame.',
  execution: { kind: 'sync', mutation: 'document' },
  input: v.object({
    id: nodeIdInput,
    title: v.optional(v.pipe(v.string(), v.description('Screen title'))),
    columns: v.optional(
      v.array(v.pipe(columnInput, v.description('Column to rename or remap')))
    ),
    rows: v.pipe(v.array(rowInput), v.description('Rows: field to value'))
  }),
  execute: (figma, { id, title, columns, rows }) => {
    const node = figma.graph.getNode(id)
    if (!node) return { error: `Node "${id}" not found` }
    const frame = node.type === 'FRAME' ? node : ancestorFrame(figma, id)
    if (!frame) return { error: `Node "${id}" is not inside a screen` }
    const resolved = resolveScreenTemplate(figma.graph, frame.id)
    if (!resolved) {
      return {
        error: `Frame "${frame.name.trim()}" carries no screen template — build the screen from a template first, or fill it cell by cell.`
      }
    }

    const applied = applyColumns(figma.graph, resolved, columns ?? [])
    if (title) setTitle(figma.graph, frame, resolved, title)
    const filled = applyRows(figma.graph, frame, resolved, applied, rows)
    if (filled.error) return filled

    return {
      id: frame.id,
      name: frame.name.trim(),
      titleSet: Boolean(title),
      columns: applied.map((column) => ({
        index: column.index,
        title: column.title,
        field: column.field ?? null,
        kind: column.kind
      })),
      rows: filled.count,
      next: 'Check the screen against the template rules: no placeholders left, statuses and badges picked by meaning, row count equal to the data, and the title on one line.'
    }
  }
})

type Column = ResolvedScreenTemplate['columns'][number]

function kids(graph: SceneGraph, node: SceneNode | undefined): SceneNode[] {
  const children: SceneNode[] = []
  for (const childId of node?.childIds ?? []) {
    const child = graph.getNode(childId)
    if (child) children.push(child)
  }
  return children
}

function findDeep(
  graph: SceneGraph,
  node: SceneNode,
  predicate: (candidate: SceneNode) => boolean
): SceneNode | undefined {
  for (const child of kids(graph, node)) {
    if (predicate(child)) return child
    const deep = findDeep(graph, child, predicate)
    if (deep) return deep
  }
  return undefined
}

function childByName(graph: SceneGraph, node: SceneNode, name: string): SceneNode | undefined {
  return kids(graph, node).find((child) => child.name.trim() === name)
}

/** Кадр-экран, внутри которого лежит узел. */
function ancestorFrame(figma: FigmaAPI, id: string): SceneNode | undefined {
  let current = figma.graph.getNode(id)
  while (current?.parentId) {
    const parent = figma.graph.getNode(current.parentId)
    if (!parent) return undefined
    if (parent.type === 'FRAME') return parent
    current = parent
  }
  return undefined
}

/**
 * Текст внутри инстанса: пишем в узел и в записи всех инстансов над ним.
 * Иначе правка видна на канвасе, а в файл не попадает.
 */
function setTextIn(graph: SceneGraph, textNode: SceneNode, value: string): void {
  graph.updateNode(textNode.id, { text: value })
  let current = textNode.parentId ? graph.getNode(textNode.parentId) : undefined
  while (current) {
    if (current.type === 'INSTANCE') {
      setInstanceOverride(current.instanceOverrides, current.id, textNode.id, 'text', value)
      graph.updateNode(current.id, { instanceOverrides: current.instanceOverrides })
    }
    current = current.parentId ? graph.getNode(current.parentId) : undefined
  }
}

function applyColumns(
  graph: SceneGraph,
  resolved: ResolvedScreenTemplate,
  requested: { index: number; title?: string; field?: string }[]
): Column[] {
  return resolved.columns.map((column) => {
    const override = requested.find((item) => item.index === column.index)
    const title = override?.title ?? column.title
    const field = override?.field ?? column.field
    if (override?.title && column.headerTextId) {
      const header = graph.getNode(column.headerTextId)
      if (header) setTextIn(graph, header, override.title)
    }
    return {
      ...column,
      title,
      ...(field ? { field } : {})
    }
  })
}

function setTitle(
  graph: SceneGraph,
  frame: SceneNode,
  resolved: ResolvedScreenTemplate,
  title: string
): void {
  const name = resolved.template.layout?.title ?? 'Заголовок'
  const node = findDeep(graph, frame, (child) => child.type === 'TEXT' && child.name.trim() === name)
  if (node) setTextIn(graph, node, title)
}

/** Строки таблицы и разделитель за каждой из них. */
function tableParts(graph: SceneGraph, frame: SceneNode) {
  const table = findDeep(graph, frame, (child) => child.name.trim() === 'Таблица')
  if (!table) return null
  const rows = kids(graph, table).filter((child) => /^Строка (\d+)$/.test(child.name.trim()))
  return { table, rows }
}

function separatorAfter(graph: SceneGraph, table: SceneNode, row: SceneNode): SceneNode | undefined {
  const index = table.childIds.indexOf(row.id)
  const next = index === -1 ? undefined : table.childIds[index + 1]
  const candidate = next ? graph.getNode(next) : undefined
  return candidate && /^Разделитель (\d+)$/.test(candidate.name.trim()) ? candidate : undefined
}

/** Переименование копии ряда под её номер: «Строка 3», «Ячейка 3.2». */
function renameRow(graph: SceneGraph, row: SceneNode, rowNumber: number): void {
  graph.updateNode(row.id, { name: `Строка ${rowNumber}` })
  for (const cell of kids(graph, row)) {
    const column = cell.name.trim().split('.')[1]
    if (!column) continue
    graph.updateNode(cell.id, { name: `Ячейка ${rowNumber}.${column}` })
  }
}

function specForColumn(
  resolved: ResolvedScreenTemplate,
  column: Column,
  rawValue: string
): ScreenTemplateVariantSpec | null {
  const [meaning = '', caption] = rawValue.split('|')
  const sense = meaning.trim()
  if (column.kind === 'check') {
    let checked = 'No'
    const value = sense.toLowerCase()
    if (value === 'yes' || value === 'да') checked = 'Yes'
    else if (value === 'indeterminate') checked = 'Indeterminate'
    return { component: 'Checkbox', values: { State: 'Default', Checked: checked, Text: 'No' } }
  }
  if (column.kind === 'badge') {
    const fromDictionary = variantForSense(resolved.template.badges, sense)
    if (fromDictionary) return fromDictionary
    if (sense.includes('=')) return parseVariantSpec('badge', sense)
    return sense ? { component: 'badge', values: { Color: sense, Content: 'Text only' } } : null
  }
  if (column.kind === 'status') {
    const fromDictionary = variantForSense(resolved.template.statuses, sense)
    if (fromDictionary) return fromDictionary
    if (sense.includes('=')) return parseVariantSpec('✅status', sense)
    return sense
      ? {
          component: '✅status',
          values: { Severity: sense, Content: 'text-only', Size: 'Ladge', Outline: 'no' }
        }
      : null
  }
  void caption
  return null
}

/** «Severity=success, Content=text-only» → набор значений варианта. */
function parseVariantSpec(component: string, text: string): ScreenTemplateVariantSpec {
  const values: Record<string, string> = {}
  for (const part of text.split(',')) {
    const [key, ...rest] = part.split('=')
    const name = key.trim()
    const value = rest.join('=').trim()
    if (name && value) values[name] = value
  }
  return { component, values }
}

/** Подпись внутри варианта: «VALUE», «STATUS» или своя из «смысл|подпись». */
function applyCaption(text: string | undefined, nested: SceneNode, graph: SceneGraph): void {
  if (!text) return
  const label = findDeep(graph, nested, (child) => child.type === 'TEXT')
  if (label) setTextIn(graph, label, text)
}

function applyRows(
  graph: SceneGraph,
  frame: SceneNode,
  resolved: ResolvedScreenTemplate,
  columns: Column[],
  rows: Record<string, string>[]
): { count: number; error?: string } {
  const parts = tableParts(graph, frame)
  if (!parts || parts.rows.length === 0) {
    return { count: 0, error: 'В экране нет таблицы с рядом-образцом' }
  }
  const pattern = parts.rows[0]
  const patternCells = kids(graph, pattern)

  // Число рядов приводим к данным: лишние убираем вместе с разделителями,
  // недостающие — копируем с образца.
  while (parts.rows.length > rows.length) {
    const extra = parts.rows.at(-1)
    if (!extra) break
    const separator = separatorAfter(graph, parts.table, extra)
    if (separator) graph.deleteNode(separator.id)
    graph.deleteNode(extra.id)
    parts.rows.pop()
  }
  while (parts.rows.length < rows.length) {
    const copy = graph.cloneTree(pattern.id, parts.table.id)
    if (copy === null) break
    cloneSeparatorAfter(graph, parts.table, copy)
    parts.rows.push(copy)
  }

  rows.forEach((rowData, index) => {
    const row = parts.rows.at(index)
    if (!row) return
    renameRow(graph, row, index + 1)
    renameSeparator(graph, parts.table, row, index + 1)
    for (const column of columns) {
      const cell =
        childByName(graph, row, `Ячейка ${index + 1}.${column.index}`) ??
        patternCells.at(column.index - 1)
      if (!cell) continue
      const value = column.field ? (rowData[column.field] ?? '') : ''
      if (column.kind === 'text') {
        const text = findDeep(graph, cell, (child) => child.type === 'TEXT')
        if (text) setTextIn(graph, text, value)
        continue
      }
      const spec = specForColumn(resolved, column, value)
      if (!spec) continue
      const nested = findDeep(
        graph,
        cell,
        (child) => child.type === 'INSTANCE' && child.componentId !== null
      )
      if (!nested) continue
      const variant = findVariantByValues(graph, spec.component, spec.values)
      if (!variant) continue
      graph.swapInstanceComponent(nested.id, variant.id)
      const swapped = findDeep(
        graph,
        cell,
        (child) => child.type === 'INSTANCE' && child.componentId === variant.id
      )
      applyCaption(value.split('|')[1], swapped ?? nested, graph)
    }
  })

  return { count: rows.length }
}

/** Копия разделителя сразу за рядом: она есть у образца, значит нужна и копии. */
function cloneSeparatorAfter(graph: SceneGraph, table: SceneNode, row: SceneNode): void {
  const pattern = kids(graph, table).find((child) => /^Разделитель (\d+)$/.test(child.name.trim()))
  if (!pattern) return
  const copy = graph.cloneTree(pattern.id, table.id)
  if (!copy) return
  const rowIndex = table.childIds.indexOf(row.id)
  if (rowIndex !== -1) graph.reorderChild(copy.id, table.id, rowIndex + 1)
}

function renameSeparator(graph: SceneGraph, table: SceneNode, row: SceneNode, index: number): void {
  const separator = separatorAfter(graph, table, row)
  if (separator) graph.updateNode(separator.id, { name: `Разделитель ${index}` })
}
