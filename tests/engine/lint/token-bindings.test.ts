import { describe, expect, test } from 'bun:test'

import { SceneGraph, createLinter } from '@open-pencil/core'

function addScaleVariable(graph: SceneGraph, id: string, value: number): void {
  graph.addCollection({
    id: 'scale',
    name: 'Scale',
    modes: [{ modeId: 'value', name: 'Value' }],
    defaultModeId: 'value',
    variableIds: []
  })
  graph.addVariable({
    id,
    name: `space/${value}`,
    type: 'FLOAT',
    collectionId: 'scale',
    valuesByMode: { value },
    description: '',
    hiddenFromPublishing: false
  })
}

function lint(graph: SceneGraph, nodeId: string): string[] {
  return createLinter({ preset: 'recommended' })
    .lintGraph(graph, [nodeId])
    .messages.map((message) => message.ruleId)
}

describe('spacing and radius respect variable bindings', () => {
  test('reports an off-scale padding that has no token', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const frame = graph.createNode('FRAME', page.id, {
      name: 'Card',
      width: 200,
      height: 80,
      layoutMode: 'VERTICAL',
      paddingLeft: 10
    })

    expect(lint(graph, frame.id)).toContain('consistent-spacing')
  })

  test('stays quiet when the same padding is bound to a token', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const frame = graph.createNode('FRAME', page.id, {
      name: 'Card',
      width: 200,
      height: 80,
      layoutMode: 'VERTICAL',
      paddingLeft: 10
    })
    addScaleVariable(graph, 'VariableID:scale/space/10', 10)
    graph.bindVariable(frame.id, 'paddingLeft', 'VariableID:scale/space/10')

    expect(lint(graph, frame.id)).not.toContain('consistent-spacing')
  })

  test('reports an off-scale radius that has no token', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const frame = graph.createNode('FRAME', page.id, { name: 'Card', width: 200, height: 80 })
    const box = graph.createNode('RECTANGLE', frame.id, {
      name: 'Box',
      width: 40,
      height: 40,
      cornerRadius: 11
    })

    expect(lint(graph, box.id)).toContain('consistent-radius')
  })

  test('stays quiet when the same radius is bound to a token', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const frame = graph.createNode('FRAME', page.id, { name: 'Card', width: 200, height: 80 })
    const box = graph.createNode('RECTANGLE', frame.id, {
      name: 'Box',
      width: 40,
      height: 40,
      cornerRadius: 11
    })
    addScaleVariable(graph, 'VariableID:scale/radius/12', 12)
    graph.bindVariable(box.id, 'cornerRadius', 'VariableID:scale/radius/12')

    expect(lint(graph, box.id)).not.toContain('consistent-radius')
  })
})
