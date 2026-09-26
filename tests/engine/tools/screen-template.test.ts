import { describe, expect, test } from 'bun:test'

import { readScreenTemplate, writeScreenTemplate } from '@open-pencil/core/tools'

import { getTool, setupToolTest, type ToolResult } from '#tests/helpers/tools'

const TEMPLATE = {
  purpose: 'Список однотипных записей с фильтрами и статусами.',
  use: ['Когда записей больше десятка и поля у них одинаковые.'],
  avoid: ['Когда записей одна-две.'],
  zones: ['Шапка экрана', 'Таблица'],
  columns: [
    { index: 1, title: 'Версия ПО', field: 'version', width: 170, kind: 'text' as const },
    { index: 2, title: 'ПАК', kind: 'status' as const }
  ],
  statuses: [{ sense: 'хорошо', variant: 'Severity=success' }],
  checks: ['Рядов столько, сколько данных.']
}

/** Кадр-эталон: шапка, один ряд и ячейка с текстом. */
function setupTemplate(): ReturnType<typeof setupToolTest> & { frameId: string } {
  const { figma, graph } = setupToolTest()
  const page = graph.getPages()[0]
  const frame = graph.createNode('FRAME', page.id, { name: 'Эталон · Отчёт', width: 900, height: 400 })
  const table = graph.createNode('FRAME', frame.id, { name: 'Таблица' })
  const header = graph.createNode('FRAME', table.id, { name: 'Шапка таблицы' })
  graph.createNode('TEXT', header.id, { name: 'Шапка 1', text: 'Версия ПО' })
  graph.createNode('TEXT', header.id, { name: 'Шапка 2', text: 'ПАК' })
  const row = graph.createNode('FRAME', table.id, { name: 'Строка 1' })
  const cell = graph.createNode('FRAME', row.id, { name: 'Ячейка 1.1' })
  graph.createNode('TEXT', cell.id, { name: 'Text', text: 'Text' })
  const statusCell = graph.createNode('FRAME', row.id, { name: 'Ячейка 1.2' })
  graph.createNode('TEXT', statusCell.id, { name: 'STATUS', text: 'STATUS' })
  writeScreenTemplate(graph, frame.id, TEMPLATE)
  return { figma, graph, frameId: frame.id }
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
      undefined
    ])
    const rows = result.rows as { count: number; pattern: { cells: { field?: string }[] } }
    expect(rows.count).toBe(1)
    expect(rows.pattern.cells.map((cell) => cell.field)).toEqual(['version', undefined])
    expect(result.checks).toEqual(['Рядов столько, сколько данных.'])
  })

  test('a frame without a template is not a screen template', () => {
    const { figma, graph } = setupToolTest()
    const frame = graph.createNode('FRAME', graph.getPages()[0].id, { name: 'Просто кадр' })

    const result = getTool('get_screen_template').execute(figma, { id: frame.id }) as ToolResult

    expect(result.found).toBe(false)
  })
})
