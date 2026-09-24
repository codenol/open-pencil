import { describe, expect, test } from 'bun:test'

import { expectDefined, getNodeOrThrow } from '#tests/helpers/assert'
import { getTool, setupToolTest, type ToolResult } from '#tests/helpers/tools'

/**
 * Кого касается наполнение места.
 *
 * Место внутри рабочей копии принадлежит экрану: назначение ложится на его
 * экземпляр, мастер и соседние экраны остаются как были. Место в мастере —
 * общий случай: блок расходится по всем копиям.
 */
function buildScreenPair() {
  const { figma, graph } = setupToolTest()
  const page = graph.getPages()[0]
  const layout = graph.createNode('COMPONENT', page.id, {
    name: 'Layout',
    componentPropertyDefinitions: [{ id: 'prop:slot', name: 'Main', type: 'SLOT', defaultValue: '' }]
  })
  const masterSlot = graph.createNode('FRAME', layout.id, {
    name: 'Main container',
    componentPropertyReferences: [{ propertyId: 'prop:slot', field: 'SLOT' }]
  })
  const block = graph.createNode('COMPONENT', page.id, { name: 'Red card' })
  const first = expectDefined(graph.createInstance(layout.id, page.id), 'first instance')
  const second = expectDefined(graph.createInstance(layout.id, page.id), 'second instance')
  const firstSlot = expectDefined(graph.getChildren(first.id)[0], 'first slot copy')
  const secondSlot = expectDefined(graph.getChildren(second.id)[0], 'second slot copy')
  return { figma, graph, page, masterSlot, block, first, second, firstSlot, secondSlot }
}

describe('slot filling scope', () => {
  test('fills the place of the screen it was given, leaving the master and the other screen alone', () => {
    const { figma, graph, masterSlot, block, first, second, firstSlot, secondSlot } =
      buildScreenPair()

    const result = getTool('fill_slot').execute(figma, {
      id: secondSlot.id,
      component_id: block.id
    }) as ToolResult

    expect(result.error).toBeUndefined()
    const placedId = result.placed as string
    expect(placedId).toBeTruthy()

    const placed = getNodeOrThrow(graph, placedId)
    expect(placed.componentId).toBe(block.id)
    expect(placed.parentId).toBe(secondSlot.id)
    expect(getNodeOrThrow(graph, second.id).componentPropertyAssignments['prop:slot']).toBe(block.id)

    expect(
      getNodeOrThrow(graph, first.id).componentPropertyAssignments['prop:slot']
    ).toBeUndefined()
    expect(graph.getChildren(firstSlot.id)).toHaveLength(0)
    expect(graph.getChildren(masterSlot.id)).toHaveLength(0)
  })

  test('fills the master place when the master is the node that was given', () => {
    const { figma, graph, masterSlot, block, first, second } = buildScreenPair()

    const result = getTool('fill_slot').execute(figma, {
      id: masterSlot.id,
      component_id: block.id
    }) as ToolResult

    expect(result.error).toBeUndefined()
    const children = graph.getChildren(masterSlot.id)
    expect(children).toHaveLength(1)
    expect(children[0]?.componentId).toBe(block.id)
    expect(
      getNodeOrThrow(graph, first.id).componentPropertyAssignments['prop:slot']
    ).toBeUndefined()
    expect(
      getNodeOrThrow(graph, second.id).componentPropertyAssignments['prop:slot']
    ).toBeUndefined()
  })

  test('reports nothing to do when the screen already holds this block', () => {
    const { figma, graph, block, second, secondSlot } = buildScreenPair()
    const fill = getTool('fill_slot')
    fill.execute(figma, { id: secondSlot.id, component_id: block.id })

    const again = fill.execute(figma, {
      id: secondSlot.id,
      component_id: block.id
    }) as ToolResult

    expect(again.error).toBeUndefined()
    expect(again.unchanged).toBe(true)
    expect(graph.getChildren(secondSlot.id)).toHaveLength(1)
    expect(getNodeOrThrow(graph, second.id).componentPropertyAssignments['prop:slot']).toBe(block.id)
  })

  test('drawing into the place of one screen gives a component of its own on that screen only', async () => {
    const { figma, graph, page, masterSlot, first, second, firstSlot, secondSlot } =
      buildScreenPair()

    const result = (await getTool('render').execute(figma, {
      parent_id: secondSlot.id,
      jsx: '<Frame name="Cards row" w={320} h={120} bg="#FFF" />'
    })) as ToolResult

    expect(result.error).toBeUndefined()
    const componentId = result.componentId as string
    expect(componentId).toBeTruthy()

    const component = getNodeOrThrow(graph, componentId)
    expect(component.type).toBe('COMPONENT')
    expect(component.parentId).toBe(page.id)

    const children = graph.getChildren(secondSlot.id)
    expect(children).toHaveLength(1)
    expect(children[0]?.componentId).toBe(componentId)
    expect(getNodeOrThrow(graph, second.id).componentPropertyAssignments['prop:slot']).toBe(
      componentId
    )

    expect(
      getNodeOrThrow(graph, first.id).componentPropertyAssignments['prop:slot']
    ).toBeUndefined()
    expect(graph.getChildren(firstSlot.id)).toHaveLength(0)
    expect(graph.getChildren(masterSlot.id)).toHaveLength(0)
  })
})
