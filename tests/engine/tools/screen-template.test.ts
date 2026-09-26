import { describe, expect, test } from 'bun:test'

import { readScreenTemplate, writeScreenTemplate } from '@open-pencil/core/tools'

import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { getTool, setupToolTest, type ToolResult } from '#tests/helpers/tools'

const MEANINGS = [
  { sense: 'хорошо', variant: { component: '✅status', values: { Severity: 'success' } } },
  { sense: 'беда', variant: { component: '✅status', values: { Severity: 'critical' } } }
]

const TEMPLATE = {
  purpose: 'Список однотипных записей с фильтрами и статусами.',
  use: ['Когда записей больше десятка и поля у них одинаковые.'],
  avoid: ['Когда записей одна-две.'],
  zones: ['Шапка экрана', 'Таблица'],
  columns: [
    { index: 1, title: 'Версия ПО', field: 'version', width: 170, kind: 'text' as const },
    { index: 2, title: 'ПАК', field: 'status', kind: 'status' as const }
  ],
  statuses: MEANINGS,
  checks: ['Рядов столько, сколько данных.']
}

/** Кадр-эталон: шапка, разделитель, ряд с текстом и вложенным статусом. */
function setupTemplate(): ReturnType<typeof setupToolTest> & {
  frameId: string
  statusVariants: { success: string; critical: string }
} {
  const { figma, graph } = setupToolTest()
  const page = graph.getPages()[0]
  const statusSet = graph.createNode('COMPONENT_SET', page.id, { name: '✅status' })
  const success = graph.createNode('COMPONENT', statusSet.id, {
    name: 'Severity=success',
    componentPropertyValues: { Severity: 'success' }
  })
  const critical = graph.createNode('COMPONENT', statusSet.id, {
    name: 'Severity=critical',
    componentPropertyValues: { Severity: 'critical' }
  })
  graph.createNode('TEXT', success.id, { name: 'STATUS', text: 'STATUS' })
  graph.createNode('TEXT', critical.id, { name: 'STATUS', text: 'STATUS' })
  const titleNode = graph.createNode('TEXT', page.id, { name: 'title-source', text: 'Заголовок' })

  const frame = graph.createNode('FRAME', page.id, { name: 'Эталон · Отчёт', width: 900, height: 400 })
  graph.createNode('TEXT', frame.id, { name: 'Заголовок', text: 'Отчёт о прошивках' })
  const table = graph.createNode('FRAME', frame.id, { name: 'Таблица' })
  const header = graph.createNode('FRAME', table.id, { name: 'Шапка таблицы' })
  graph.createNode('TEXT', header.id, { name: 'Шапка 1', text: 'Версия ПО' })
  graph.createNode('TEXT', header.id, { name: 'Шапка 2', text: 'ПАК' })
  const row = graph.createNode('FRAME', table.id, { name: 'Строка 1' })
  const cell = graph.createNode('FRAME', row.id, { name: 'Ячейка 1.1' })
  graph.createNode('TEXT', cell.id, { name: 'Text', text: 'Text' })
  const statusCell = graph.createNode('FRAME', row.id, { name: 'Ячейка 1.2' })
  graph.createInstance(success.id, statusCell.id)
  graph.createNode('TEXT', statusCell.id, { name: 'STATUS', text: 'STATUS' })
  graph.createNode('FRAME', table.id, { name: 'Разделитель 1' })
  void titleNode
  writeScreenTemplate(graph, frame.id, TEMPLATE)
  return { figma, graph, frameId: frame.id, statusVariants: { success: success.id, critical: critical.id } }
}

describe('screen template reaches the assistant', () => {
  test('the template is read back from the frame', () => {
    const { graph, frameId } = setupTemplate()

    expect(readScreenTemplate(graph, frameId)).toEqual(TEMPLATE)
  })

  test('get_node returns the template with the frame', () => {
    const { figma, frameId } = setupTemplate()

    const result = getTool('get_node').execute(figma, { id: frameId, depth: 0 }) as ToolResult

    expect(result.error).toBeUndefined()
    expect(result.template).toEqual(TEMPLATE)
  })

  test('list_screen_templates finds the template and skips plain frames', () => {
    const { figma, graph, frameId } = setupTemplate()
    graph.createNode('FRAME', graph.getPages()[0].id, { name: 'Обычный кадр' })

    const result = getTool('list_screen_templates').execute(figma, {}) as ToolResult
    const templates = result.templates as { id: string }[]

    expect(result.count).toBe(1)
    expect(templates[0]?.id).toBe(frameId)
  })

  test('get_screen_template resolves columns, the row pattern and the cell texts', () => {
    const { figma, frameId } = setupTemplate()

    const result = getTool('get_screen_template').execute(figma, { id: frameId }) as ToolResult

    expect(result.found).toBe(true)
    expect((result.columns as { field?: string }[]).map((column) => column.field)).toEqual([
      'version',
      'status'
    ])
    const rows = result.rows as { count: number; pattern: { cells: { field?: string }[] } }
    expect(rows.count).toBe(1)
    expect(rows.pattern.cells.map((cell) => cell.field)).toEqual(['version', 'status'])
    expect(result.checks).toEqual(['Рядов столько, сколько данных.'])
  })

  test('a frame without a template is not a screen template', () => {
    const { figma, graph } = setupToolTest()
    const frame = graph.createNode('FRAME', graph.getPages()[0].id, { name: 'Просто кадр' })

    const result = getTool('get_screen_template').execute(figma, { id: frame.id }) as ToolResult

    expect(result.found).toBe(false)
  })
})

describe('a screen built from a template', () => {
  test('insert_screen_template copies the screen, keeps the rules and is not listed as a template', () => {
    const { figma, graph, frameId } = setupTemplate()
    const page = graph.getPages()[0]

    const result = getTool('insert_screen_template').execute(figma, {
      id: frameId,
      name: 'Отчёт по прошивкам'
    }) as ToolResult

    expect(result.error).toBeUndefined()
    expect(result.name).toBe('Отчёт по прошивкам')
    const copy = graph.getNode(result.id as string)
    expect(copy?.parentId).toBe(page.id)
    // Копия — экран, а не образец, но правила эталона едут с ней: по ним её
    // наполняют. В списке эталонов её при этом быть не должно.
    const copied = readScreenTemplate(graph, result.id as string)
    expect(copied?.derivedFrom).toBe(frameId)
    expect(copied?.purpose).toBe(TEMPLATE.purpose)
    const listed = getTool('list_screen_templates').execute(figma, {}) as ToolResult
    expect(listed.count).toBe(1)
    // Строение копии совпадает с образцом.
    const rows = result.rows as { count: number }
    expect(rows.count).toBe(1)
  })

  test('a node without a template cannot be inserted as a screen', () => {
    const { figma, graph } = setupToolTest()
    const frame = graph.createNode('FRAME', graph.getPages()[0].id, { name: 'Просто кадр' })

    const result = getTool('insert_screen_template').execute(figma, { id: frame.id }) as ToolResult

    expect(result.error).toBeDefined()
  })
})

describe('a screen is filled with data in one call', () => {
  test('text, status variant, caption and row count are set from the rows', () => {
    const { figma, graph, frameId, statusVariants } = setupTemplate()

    const result = getTool('fill_screen_template').execute(figma, {
      id: frameId,
      title: 'Кластеры PostgreSQL',
      columns: [{ index: 1, title: 'Кластер' }],
      rows: [
        { version: 'pg-core-01', status: 'хорошо|ОК' },
        { version: 'pg-core-02', status: 'беда|Сбой' },
        { version: 'pg-core-03', status: 'хорошо|ОК' }
      ]
    }) as ToolResult

    expect(result.error).toBeUndefined()
    expect(result.rows).toBe(3)
    const table = graph.getNode(frameId)?.childIds.map((childId) => graph.getNode(childId))
    const tableNode = table?.find((node) => node?.name.trim() === 'Таблица')
    if (!tableNode) throw new Error('table not found')
    const rows = tableNode.childIds
      .map((childId) => graph.getNode(childId))
      .filter((node) => node?.name.trim().startsWith('Строка'))
    expect(rows.map((row) => row?.name.trim())).toEqual(['Строка 1', 'Строка 2', 'Строка 3'])

    const firstStatus = findDeep(graph, rows[0] as never, 'Severity=success')
    expect(firstStatus?.componentId).toBe(statusVariants.success)
    const secondStatus = findDeep(graph, rows[1] as never, 'Severity=critical')
    expect(secondStatus?.componentId).toBe(statusVariants.critical)
    const captions = rows.map((row) => findText(graph, row as never, 'STATUS') ?? findAnyText(graph, row as never))
    expect(captions[0]).toBe('ОК')
    expect(captions[1]).toBe('Сбой')
  })

  test('extra rows are trimmed back to the data', () => {
    const { figma, graph } = setupTemplate()
    const frameId = findFrameId(graph)

    const result = getTool('fill_screen_template').execute(figma, {
      id: frameId,
      rows: [{ version: 'pg-core-01', status: 'хорошо' }]
    }) as ToolResult

    expect(result.rows).toBe(1)
    const table = graph.getNode(frameId)?.childIds.map((childId) => graph.getNode(childId))
    const tableNode = table?.find((node) => node?.name.trim() === 'Таблица')
    const rows = (tableNode?.childIds ?? [])
      .map((childId) => graph.getNode(childId))
      .filter((node) => node?.name.trim().startsWith('Строка'))
    expect(rows).toHaveLength(1)
  })
})

function findFrameId(graph: SceneGraph): string {
  for (const node of graph.getAllNodes()) {
    if (node.type === 'FRAME' && node.name.trim() === 'Эталон · Отчёт') return node.id
  }
  throw new Error('template frame not found')
}

function findDeep(
  graph: SceneGraph,
  node: SceneNode,
  name: string
): SceneNode | undefined {
  for (const childId of node.childIds) {
    const child = graph.getNode(childId)
    if (!child) continue
    if (child.name.trim() === name) return child
    const deep = findDeep(graph, child, name)
    if (deep) return deep
  }
  return undefined
}

function findText(graph: SceneGraph, node: SceneNode, name: string): string | undefined {
  return findDeep(graph, node, name)?.text
}

function findAnyText(graph: SceneGraph, node: SceneNode): string | undefined {
  for (const childId of node.childIds) {
    const child = graph.getNode(childId)
    if (!child) continue
    if (child.type === 'TEXT') return child.text
    const deep = findAnyText(graph, child)
    if (deep) return deep
  }
  return undefined
}
