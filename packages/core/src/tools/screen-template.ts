/**
 * Эталон экрана — правила сборки экрана и разбор его строения.
 *
 * Правила компонента отвечают на вопрос «как собрать деталь». Правила эталона
 * отвечают на другой: из каких зон состоит экран, что повторяется, какие поля
 * данных куда ложатся, какие места чем заполнены и чем экран отличается от
 * мастера. Лежат они в pluginData кадра и едут вместе с ним — как правила
 * компонента едут с компонентом.
 *
 * Разбор статический (что за экран и по каким правилам) и динамический
 * (живые ссылки на шапку, ряды, ячейки и места). Динамику снимаем с самого
 * кадра: тогда разбор не расходится со сборкой.
 */
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

export const TEMPLATE_PLUGIN_ID = 'norka.design-system'
export const TEMPLATE_KEY = 'screen-template'

/** Место экрана и блок, которым оно заполнено. */
export interface ScreenTemplateSlot {
  name: string
  propertyId: string
  blockId: string
  blockName: string
}

/** Колонка таблицы: подпись, поле данных и пара «шапка + ячейка». */
export interface ScreenTemplateColumn {
  index: number
  title: string
  field?: string
  width: number
  /** Вид ячейки. Объявленный в разборе важнее выведенного из образца. */
  kind?: 'text' | 'badge' | 'status' | 'check' | 'empty'
  headerVariant?: string
  cellVariant?: string
}

/** Вариант компонента: набор значений свойств. */
export interface ScreenTemplateVariantSpec {
  component: string
  values: Record<string, string>
}

/** Смысл и вариант, который ему соответствует. */
export interface ScreenTemplateMeaning {
  sense: string
  /** Вариант, которым смысл выражается. Строка — заметка для человека. */
  variant?: ScreenTemplateVariantSpec | string
  note?: string
}

export interface ScreenTemplateLayout {
  /** Заголовок экрана: узел, который меняют при сборке нового экрана. */
  title?: string
  /** Имя ряда-образца и шаблон имён ячеек: «Ячейка 1.1». */
  headerRow?: string
  rowPattern?: string
  cellPattern?: string
  separator?: string
}

export interface ScreenTemplate {
  /** Экран, собранный из эталона: сам эталоном не считается, но правила несёт. */
  derivedFrom?: string
  purpose?: string
  use?: string[]
  avoid?: string[]
  zones?: string[]
  layout?: ScreenTemplateLayout
  columns?: ScreenTemplateColumn[]
  slots?: ScreenTemplateSlot[]
  statuses?: ScreenTemplateMeaning[]
  badges?: ScreenTemplateMeaning[]
  allowed?: string[]
  forbidden?: string[]
  checks?: string[]
  issues?: string[]
}

interface PluginEntry {
  pluginId: string
  key: string
  value: string
}

interface NodeWithPluginData {
  pluginData?: PluginEntry[]
}

const STRING_LIST_KEYS = [
  'use',
  'avoid',
  'zones',
  'allowed',
  'forbidden',
  'checks',
  'issues'
] as const

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isVariantSpec(value: unknown): value is ScreenTemplateVariantSpec {
  return (
    isRecord(value) &&
    typeof value.component === 'string' &&
    isRecord(value.values)
  )
}

function isMeaningArray(value: unknown): value is ScreenTemplateMeaning[] {
  return (
    Array.isArray(value) &&
    value.every((item) => isRecord(item) && typeof item.sense === 'string')
  )
}

/**
 * Вариант набора по значениям свойств: «Severity=success, Content=text-only».
 * Возвращает компонент варианта — тот, который ставят свопом.
 */
export function findVariantByValues(
  graph: SceneGraph,
  setName: string,
  values: Record<string, string>
): SceneNode | null {
  const wanted = Object.entries(values)
  for (const node of graph.getAllNodes()) {
    if (node.type !== 'COMPONENT') continue
    if (node.parentId) {
      const set = graph.getNode(node.parentId)
      if (set?.type === 'COMPONENT_SET') {
        const current = node.componentPropertyValues
        if (set.name.trim() !== setName) continue
        if (wanted.every(([key, value]) => current[key] === value)) return node
      }
    }
  }
  return null
}

/** Вариант по смыслу: «хорошо» → набор значений из разбора эталона. */
export function variantForSense(
  meanings: ScreenTemplateMeaning[] | undefined,
  sense: string
): ScreenTemplateVariantSpec | null {
  const wanted = sense.trim().toLowerCase()
  for (const meaning of meanings ?? []) {
    if (meaning.sense.trim().toLowerCase() !== wanted) continue
    if (meaning.variant && typeof meaning.variant === 'object') return meaning.variant
  }
  return null
}

function isColumnArray(value: unknown): value is ScreenTemplateColumn[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        item !== null &&
        typeof item === 'object' &&
        typeof (item as ScreenTemplateColumn).index === 'number' &&
        typeof (item as ScreenTemplateColumn).title === 'string'
    )
  )
}

function isSlotArray(value: unknown): value is ScreenTemplateSlot[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        item !== null &&
        typeof item === 'object' &&
        typeof (item as ScreenTemplateSlot).name === 'string' &&
        typeof (item as ScreenTemplateSlot).propertyId === 'string'
    )
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Смыслы со значениями варианта: строку-заметку оставляем, мусор отбрасываем. */
function parseMeanings(value: unknown): ScreenTemplateMeaning[] | undefined {
  if (!isMeaningArray(value)) return undefined
  return value.filter(
    (meaning) =>
      meaning.variant === undefined ||
      typeof meaning.variant === 'string' ||
      isVariantSpec(meaning.variant)
  )
}

function parse(value: string): ScreenTemplate | null {
  try {
    const source: unknown = JSON.parse(value)
    if (!isRecord(source)) return null
    const template: ScreenTemplate = {}
    if (typeof source.derivedFrom === 'string') template.derivedFrom = source.derivedFrom
    if (typeof source.purpose === 'string') template.purpose = source.purpose
    for (const key of STRING_LIST_KEYS) {
      const list = source[key]
      if (isStringArray(list)) template[key] = list
    }
    if (isColumnArray(source.columns)) template.columns = source.columns
    if (isSlotArray(source.slots)) template.slots = source.slots
    const statuses = parseMeanings(source.statuses)
    if (statuses) template.statuses = statuses
    const badges = parseMeanings(source.badges)
    if (badges) template.badges = badges
    if (isRecord(source.layout)) template.layout = source.layout
    return template
  } catch {
    return null
  }
}

/** Разбор эталона у кадра. У остальных узлов его нет. */
export function readScreenTemplate(graph: SceneGraph, nodeId: string): ScreenTemplate | null {
  const node: NodeWithPluginData | undefined = graph.getNode(nodeId)
  const entry = node?.pluginData?.find(
    (item) => item.pluginId === TEMPLATE_PLUGIN_ID && item.key === TEMPLATE_KEY
  )
  return entry ? parse(entry.value) : null
}

/** Записать разбор эталона, не затирая чужие записи pluginData. */
export function writeScreenTemplate(
  graph: SceneGraph,
  nodeId: string,
  template: ScreenTemplate
): void {
  const node = graph.getNode(nodeId)
  if (!node) throw new Error(`Node "${nodeId}" not found`)
  const rest = node.pluginData.filter(
    (item) => !(item.pluginId === TEMPLATE_PLUGIN_ID && item.key === TEMPLATE_KEY)
  )
  graph.updateNode(nodeId, {
    pluginData: [
      ...rest,
      { pluginId: TEMPLATE_PLUGIN_ID, key: TEMPLATE_KEY, value: JSON.stringify(template) }
    ]
  })
}

/**
 * Кадры-эталоны документа: у каждого есть разбор.
 * Экраны, собранные из эталона, в список не попадают — они не образцы.
 */
export function screenTemplateFrames(graph: SceneGraph): SceneNode[] {
  const frames: SceneNode[] = []
  for (const node of graph.getAllNodes()) {
    if (node.type !== 'FRAME') continue
    const template = readScreenTemplate(graph, node.id)
    if (template && !template.derivedFrom) frames.push(node)
  }
  return frames
}

export interface ResolvedCell {
  column: number
  field?: string
  id: string
  textId?: string
}

export interface ResolvedRow {
  index: number
  id: string
  name: string
  cells: ResolvedCell[]
}

export interface ResolvedSlot {
  name: string
  filledId: string | null
  blockId: string | null
  blockName: string | null
}

export interface ResolvedColumn {
  index: number
  title: string
  field?: string
  kind: NonNullable<ScreenTemplateColumn['kind']>
  width: number
  headerCellId: string | null
  headerTextId: string | null
}

/** Разбор с живыми ссылками: чем наполнять и что менять. */
export interface ResolvedScreenTemplate {
  template: ScreenTemplate
  frame: { id: string; name: string; width: number; height: number }
  columns: ResolvedColumn[]
  rows: ResolvedRow[]
  slots: ResolvedSlot[]
}

function kids(graph: SceneGraph, node: SceneNode | undefined): SceneNode[] {
  const children: SceneNode[] = []
  for (const id of node?.childIds ?? []) {
    const child = graph.getNode(id)
    if (child) children.push(child)
  }
  return children
}

/** Первый узел в глубину, подходящий под условие. */
function findDeep(
  graph: SceneGraph,
  node: SceneNode,
  predicate: (child: SceneNode) => boolean
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

/** Вид ячейки по варианту её мастера: текст, бейдж, статус, галочка, пусто. */
function kindOfCell(
  graph: SceneGraph,
  cell: SceneNode
): NonNullable<ScreenTemplateColumn['kind']> {
  const master = cell.componentId ? graph.getNode(cell.componentId) : undefined
  const content = master?.componentPropertyValues.Content ?? ''
  if (content.startsWith('Badge')) return 'badge'
  if (content.startsWith('Status')) return 'status'
  if (content.startsWith('Lead text checkbox')) return 'check'
  if (content === 'Empty') return 'empty'
  return 'text'
}

/**
 * Снять разбор с кадра: колонки из шапки, ряды и ячейки по именам, места — по
 * связям с свойствами-местами и их содержимому.
 */
export function resolveScreenTemplate(
  graph: SceneGraph,
  frameId: string
): ResolvedScreenTemplate | null {
  const frame = graph.getNode(frameId)
  if (!frame) return null
  const template = readScreenTemplate(graph, frameId)
  if (!template) return null
  const declared = template.columns ?? []

  const table = findDeep(graph, frame, (child) => child.name.trim() === 'Таблица')
  const headerRow = table
    ? childByName(graph, table, template.layout?.headerRow ?? 'Шапка таблицы')
    : undefined

  const rows = table
    ? kids(graph, table).filter((child) => /^Строка \d+$/.test(child.name.trim()))
    : []
  const widthOf = (index: number): number => {
    const sample = rows[0] ? childByName(graph, rows[0], `Ячейка 1.${index}`) : undefined
    return sample ? Math.round(sample.width) : 0
  }
  const kindOf = (index: number): NonNullable<ScreenTemplateColumn['kind']> => {
    const sample = rows[0] ? childByName(graph, rows[0], `Ячейка 1.${index}`) : undefined
    return sample ? kindOfCell(graph, sample) : 'text'
  }

  const columns: ResolvedColumn[] = declared.map((column) => {
    const cell = headerRow ? childByName(graph, headerRow, `Шапка ${column.index}`) : undefined
    const text = cell ? findDeep(graph, cell, (child) => child.type === 'TEXT') : undefined
    const resolved: ResolvedColumn = {
      index: column.index,
      title: column.title,
      kind: column.kind ?? kindOf(column.index),
      width: widthOf(column.index),
      headerCellId: cell?.id ?? null,
      headerTextId: text?.id ?? null
    }
    if (column.field) resolved.field = column.field
    return resolved
  })

  const resolvedRows: ResolvedRow[] = rows.map((row) => ({
    index: Number(row.name.trim().split(' ')[1]),
    id: row.id,
    name: row.name.trim(),
    cells: kids(graph, row).map((cell) => {
      const columnIndex = Number(cell.name.trim().split('.')[1])
      const column = declared.find((item) => item.index === columnIndex)
      const text = findDeep(graph, cell, (child) => child.type === 'TEXT')
      const resolved: ResolvedCell = { column: columnIndex, id: cell.id }
      if (column?.field) resolved.field = column.field
      if (text) resolved.textId = text.id
      return resolved
    })
  }))

  const slots: ResolvedSlot[] = (template.slots ?? []).map((slot) => {
    const slotFrame = findDeep(graph, frame, (child) =>
      child.componentPropertyReferences.some(
        (ref) => ref.field === 'SLOT' && ref.propertyId === slot.propertyId
      )
    )
    const filled = slotFrame ? kids(graph, slotFrame)[0] : undefined
    const block = filled?.componentId ? graph.getNode(filled.componentId) : undefined
    return {
      name: slot.name,
      filledId: filled?.id ?? null,
      blockId: filled?.componentId ?? null,
      blockName: block?.name.trim() ?? null
    }
  })

  return {
    template,
    frame: {
      id: frame.id,
      name: frame.name.trim(),
      width: Math.round(frame.width),
      height: Math.round(frame.height)
    },
    columns,
    rows: resolvedRows,
    slots
  }
}
