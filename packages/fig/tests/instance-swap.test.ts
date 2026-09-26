import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'
import type { GUID } from '@open-pencil/scene-graph/primitives'

import { sceneNodeToKiwi } from '../src/node-change'

/** Компонент «карточка» с вложенным инстансом внутри. */
function setupNested(): { graph: SceneGraph; instanceId: string; otherId: string; swap: () => string } {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  const inner = graph.createNode('COMPONENT', pageId, { name: 'icon' })
  const other = graph.createNode('COMPONENT', pageId, { name: 'other-icon' })
  const card = graph.createNode('COMPONENT', pageId, { name: 'card' })
  graph.createInstance(inner.id, card.id)
  const instance = graph.createInstance(card.id, pageId)
  if (!instance) throw new Error('failed to create instance')
  const nestedId = instance.childIds[0]
  return {
    graph,
    instanceId: instance.id,
    otherId: other.id,
    swap: () => {
      graph.swapInstanceComponent(nestedId, other.id)
      return nestedId
    }
  }
}

interface SwapPayload {
  guidPath?: { guids?: GUID[] }
  overriddenSymbolID?: GUID
}

/** Выгрузка узла тем же контекстом: guid компонента совпадает с тем, что в ссылке. */
function exportNested(graph: SceneGraph, instanceId: string) {
  const nodeIdToGuid = new Map<string, GUID>()
  const localIdCounter = { value: 2 }
  const instance = graph.getNode(instanceId)
  if (!instance) throw new Error('instance not found')
  const changes = sceneNodeToKiwi(
    instance,
    { sessionID: 0, localID: 0 },
    0,
    localIdCounter,
    graph,
    [],
    nodeIdToGuid
  )
  const symbolData = changes[0]?.symbolData as { symbolOverrides?: SwapPayload[] } | undefined
  return {
    overrides: symbolData?.symbolOverrides ?? [],
    guidOf: (nodeId: string): GUID | undefined => {
      const node = graph.getNode(nodeId)
      if (!node) return undefined
      return sceneNodeToKiwi(
        node,
        { sessionID: 0, localID: 0 },
        0,
        localIdCounter,
        graph,
        [],
        nodeIdToGuid
      )[0]?.guid
    }
  }
}

describe('@open-pencil/fig nested instance swaps', () => {
  test('an untouched nested instance writes no swap', () => {
    const { graph, instanceId } = setupNested()

    const swaps = exportNested(graph, instanceId).overrides.filter(
      (item) => item.overriddenSymbolID
    )

    expect(swaps).toHaveLength(0)
  })

  test('a swapped nested instance is written so it survives the file', () => {
    const { graph, instanceId, otherId, swap } = setupNested()
    swap()

    const { overrides, guidOf } = exportNested(graph, instanceId)
    const swaps = overrides.filter((item) => item.overriddenSymbolID)

    expect(swaps).toHaveLength(1)
    // Путь ведёт к узлу мастера, ссылка — на компонент, которым заменили.
    expect(swaps[0]?.guidPath?.guids).toHaveLength(1)
    expect(swaps[0]?.overriddenSymbolID).toEqual(guidOf(otherId))
  })
})
