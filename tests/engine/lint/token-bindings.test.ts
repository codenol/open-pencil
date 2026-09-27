import { describe, expect, test } from 'bun:test'

import { SceneGraph, createLinter } from '@open-pencil/core'

function addFloatVariable(graph: SceneGraph, name: string, value: number): string {
  const id = `VariableID:scale/${name}`
  if (!graph.variableCollections.has('scale')) {
    graph.addCollection({
      id: 'scale',
      name: 'Шкала',
      modes: [{ modeId: 'value', name: 'Value' }],
      defaultModeId: 'value',
      variableIds: []
    })
  }
  graph.addVariable({
    id,
    name,
    type: 'FLOAT',
    collectionId: 'scale',
    valuesByMode: { value },
    description: '',
    hiddenFromPublishing: false
  })
  return id
}

function lint(graph: SceneGraph, nodeId: string): string[] {
  return createLinter({ preset: 'recommended' })
    .lintGraph(graph, [nodeId])
    .messages.map((message) => message.ruleId)
}

function frameWithPadding(graph: SceneGraph, paddingLeft: number): string {
  const page = graph.getPages()[0]
  return graph.createNode('FRAME', page.id, {
    name: 'Card',
    width: 200,
    height: 80,
    layoutMode: 'VERTICAL',
    paddingLeft
  }).id
}

function boxWithRadius(graph: SceneGraph, cornerRadius: number): string {
  const page = graph.getPages()[0]
  const frame = graph.createNode('FRAME', page.id, { name: 'Card', width: 200, height: 80 })
  return graph.createNode('RECTANGLE', frame.id, {
    name: 'Box',
    width: 40,
    height: 40,
    cornerRadius
  }).id
}

describe('token-bound values pass the scale rules', () => {
  test('an off-scale padding without a token is reported', () => {
    const graph = new SceneGraph()
    expect(lint(graph, frameWithPadding(graph, 10))).toContain('consistent-spacing')
  })

  test('the same padding stays quiet once bound to a token', () => {
    const graph = new SceneGraph()
    const frameId = frameWithPadding(graph, 10)
    graph.bindVariable(frameId, 'paddingLeft', addFloatVariable(graph, 'space/10', 10))

    const ruleIds = lint(graph, frameId)
    expect(ruleIds).not.toContain('consistent-spacing')
    expect(ruleIds).not.toContain('no-hardcoded-spacing')
  })

  test('an off-scale radius without a token is reported', () => {
    const graph = new SceneGraph()
    expect(lint(graph, boxWithRadius(graph, 11))).toContain('consistent-radius')
  })

  test('the same radius stays quiet once bound to a token', () => {
    const graph = new SceneGraph()
    const boxId = boxWithRadius(graph, 11)
    graph.bindVariable(boxId, 'cornerRadius', addFloatVariable(graph, 'radius/12', 12))

    const ruleIds = lint(graph, boxId)
    expect(ruleIds).not.toContain('consistent-radius')
    expect(ruleIds).not.toContain('no-hardcoded-radius')
  })
})

describe('the scale rules read the document scale', () => {
  test('a step from the document scale is accepted without a binding', () => {
    const graph = new SceneGraph()
    const frameId = frameWithPadding(graph, 14)
    addFloatVariable(graph, 'space/14', 14)

    expect(lint(graph, frameId)).not.toContain('consistent-spacing')
  })

  test('a radius step from the document scale is accepted without a binding', () => {
    const graph = new SceneGraph()
    const boxId = boxWithRadius(graph, 11)
    addFloatVariable(graph, 'radius/11', 11)

    expect(lint(graph, boxId)).not.toContain('consistent-radius')
  })

  test('a value missing from the document scale is still reported', () => {
    const graph = new SceneGraph()
    const frameId = frameWithPadding(graph, 14)
    addFloatVariable(graph, 'space/16', 16)

    expect(lint(graph, frameId)).toContain('consistent-spacing')
  })
})

describe('unbound spacing and radius are reported as token debt', () => {
  test('a plain padding is reported as hardcoded', () => {
    const graph = new SceneGraph()
    expect(lint(graph, frameWithPadding(graph, 16))).toContain('no-hardcoded-spacing')
  })

  test('a plain radius is reported as hardcoded', () => {
    const graph = new SceneGraph()
    expect(lint(graph, boxWithRadius(graph, 8))).toContain('no-hardcoded-radius')
  })

  test('zero padding is not debt', () => {
    const graph = new SceneGraph()
    expect(lint(graph, frameWithPadding(graph, 0))).not.toContain('no-hardcoded-spacing')
  })

  test('a padding inside a component copy is not debt', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const instance = graph.createNode('INSTANCE', page.id, {
      name: 'Card copy',
      width: 200,
      height: 80
    })
    const inner = graph.createNode('FRAME', instance.id, {
      name: 'Inner',
      width: 100,
      height: 40,
      layoutMode: 'VERTICAL',
      paddingLeft: 16
    })

    expect(lint(graph, inner.id)).not.toContain('no-hardcoded-spacing')
  })

  test('a radius inside a component copy is not debt', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const instance = graph.createNode('INSTANCE', page.id, {
      name: 'Card copy',
      width: 200,
      height: 80
    })
    const inner = graph.createNode('RECTANGLE', instance.id, {
      name: 'Inner',
      width: 40,
      height: 40,
      cornerRadius: 8
    })

    expect(lint(graph, inner.id)).not.toContain('no-hardcoded-radius')
  })
})
