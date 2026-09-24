import { describe, expect, test } from 'bun:test'

import { readComponentRules, writeComponentRules } from '@open-pencil/core/tools'

import { getNodeOrThrow } from '#tests/helpers/assert'
import { getTool, setupToolTest, type ToolResult } from '#tests/helpers/tools'

const RULES_PLUGIN_ID = 'norka.design-system'
const RULES_KEY = 'component-rules'

const RULES = {
  purpose: 'Показывает однотипные записи строками.',
  howto: ['Реши состав колонок.', 'Собери строку из ячеек.'],
  use: ['Брать готовый компонент.'],
  forbidden: ['Рисовать таблицу с нуля.'],
  checks: ['Число строк равно числу записей.']
}

/** Компонент с правилами — как мастер дизайн-системы в файле. */
function setupComponentWithRules(): ReturnType<typeof setupToolTest> & { componentId: string } {
  const { figma, graph } = setupToolTest()
  const page = graph.getPages()[0]
  const component = graph.createNode('COMPONENT', page.id, { name: 'Table' })
  const withRules = getNodeOrThrow(graph, component.id)
  graph.updateNode(component.id, {
    pluginData: [
      ...(withRules.pluginData ?? []),
      { pluginId: RULES_PLUGIN_ID, key: RULES_KEY, value: JSON.stringify(RULES) }
    ]
  })
  return { figma, graph, componentId: component.id }
}

describe('component rules reach the assistant', () => {
  test('get_node returns the rules of the component, instruction included', () => {
    const { figma, componentId } = setupComponentWithRules()

    const result = getTool('get_node').execute(figma, { id: componentId, depth: 0 }) as ToolResult

    expect(result.error).toBeUndefined()
    expect(result.rules).toEqual(RULES)
  })

  test('get_node returns the master rules for an instance', () => {
    const { figma, graph, componentId } = setupComponentWithRules()
    const page = graph.getPages()[0]
    const instance = graph.createInstance(componentId, page.id)
    if (!instance) throw new Error('failed to create instance')

    const result = getTool('get_node').execute(figma, {
      id: instance.id,
      depth: 0
    }) as ToolResult

    expect(result.rules).toEqual(RULES)
  })

  test('a plain node carries no rules', () => {
    const { figma } = setupToolTest()
    const frame = figma.createFrame()

    const result = getTool('get_node').execute(figma, { id: frame.id, depth: 0 }) as ToolResult

    expect(result.rules).toBeUndefined()
  })
})

describe('writing component rules', () => {
  test('writes rules and reads them back', () => {
    const { graph } = setupToolTest()
    const page = graph.getPages()[0]
    const component = graph.createNode('COMPONENT', page.id, { name: 'Table' })

    expect(writeComponentRules(graph, component.id, RULES)).toBe(true)
    expect(readComponentRules(graph, component.id)).toEqual(RULES)
  })

  test('keeps the rules of a variant on its set', () => {
    const { graph } = setupToolTest()
    const page = graph.getPages()[0]
    const set = graph.createNode('COMPONENT_SET', page.id, { name: 'table cell' })
    const variant = graph.createNode('COMPONENT', set.id, { name: 'Content=Text' })

    expect(writeComponentRules(graph, variant.id, RULES)).toBe(true)
    expect(readComponentRules(graph, variant.id)).toEqual(RULES)
    expect(readComponentRules(graph, set.id)).toEqual(RULES)
  })

  test('empty rules remove the mark instead of leaving a blank entry', () => {
    const { graph } = setupToolTest()
    const page = graph.getPages()[0]
    const component = graph.createNode('COMPONENT', page.id, { name: 'Table' })
    writeComponentRules(graph, component.id, RULES)

    expect(writeComponentRules(graph, component.id, { purpose: '   ', use: ['', ' '] })).toBe(true)
    expect(readComponentRules(graph, component.id)).toBeNull()
    expect(getNodeOrThrow(graph, component.id).pluginData).toHaveLength(0)
  })
})
