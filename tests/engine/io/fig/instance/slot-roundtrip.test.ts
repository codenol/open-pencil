import { describe, expect, test } from 'bun:test'

import { exportFigFile, parseFigFile } from '@open-pencil/core/io'
import { initCodec } from '@open-pencil/core/kiwi'
import { SceneGraph } from '@open-pencil/scene-graph'

const RED = { r: 1, g: 0, b: 0, a: 1 }

function assertLayoutSlots(graph: SceneGraph): void {
  const layout = [...graph.getAllNodes()].find(
    (node) => node.type === 'COMPONENT' && node.name === 'Layout'
  )
  expect(layout).toBeDefined()
  if (!layout) return

  const masterSlot = graph.getChildren(layout.id)[0]
  expect(masterSlot.name).toBe('Main container')
  expect(graph.getChildren(masterSlot.id)).toHaveLength(0)

  const instances = [...graph.getAllNodes()].filter(
    (node) => node.type === 'INSTANCE' && node.componentId === layout.id
  )
  expect(instances).toHaveLength(2)

  const emptySlot = graph.getChildren(instances[0].id)[0]
  expect(graph.getChildren(emptySlot.id)).toHaveLength(0)

  const filledSlot = graph.getChildren(instances[1].id)[0]
  const placed = graph.getChildren(filledSlot.id)[0]
  expect(placed.type).toBe('INSTANCE')
  const content = placed.componentId ? graph.getNode(placed.componentId) : undefined
  expect(content?.name).toBe('Red card')
  expect(placed.fills[0]?.color).toEqual(RED)
}

describe('SLOT component property round trip', () => {
  test('slot content survives two save/reopen cycles without changing the master or sibling instance', async () => {
    await initCodec()

    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const layout = graph.createNode('COMPONENT', page.id, {
      name: 'Layout',
      componentPropertyDefinitions: [{ id: '1:100', name: 'Main', type: 'SLOT', defaultValue: '' }]
    })
    graph.createNode('FRAME', layout.id, {
      name: 'Main container',
      componentPropertyReferences: [{ propertyId: '1:100', field: 'SLOT' }]
    })
    const content = graph.createNode('COMPONENT', page.id, {
      name: 'Red card',
      fills: [{ type: 'SOLID', color: RED, opacity: 1, visible: true }]
    })
    const first = graph.createInstance(layout.id, page.id)
    const second = graph.createInstance(layout.id, page.id)
    if (!first || !second) throw new Error('failed to create layout instances')

    const secondSlot = graph.getChildren(second.id)[0]
    graph.updateNode(second.id, {
      componentPropertyAssignments: { '1:100': content.id }
    })
    const placed = graph.createInstance(content.id, secondSlot.id)
    if (!placed) throw new Error('failed to place slot content')
    assertLayoutSlots(graph)

    const firstExport = await exportFigFile(graph)
    const firstReload = await parseFigFile(firstExport.buffer as ArrayBuffer)
    assertLayoutSlots(firstReload)

    const secondExport = await exportFigFile(firstReload)
    const secondReload = await parseFigFile(secondExport.buffer as ArrayBuffer)
    assertLayoutSlots(secondReload)
  })

  test('a repeated swap removes an imported stale content-root fill override', async () => {
    await initCodec()

    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const layout = graph.createNode('COMPONENT', page.id, {
      name: 'Layout',
      componentPropertyDefinitions: [{ id: '1:100', name: 'Main', type: 'SLOT', defaultValue: '' }]
    })
    const slot = graph.createNode('FRAME', layout.id, {
      name: 'Main container',
      componentPropertyReferences: [{ propertyId: '1:100', field: 'SLOT' }]
    })
    const content = graph.createNode('COMPONENT', page.id, {
      name: 'Red card',
      fills: [{ type: 'SOLID', color: RED, opacity: 1, visible: true }]
    })
    graph.updateNode(layout.id, { source: { ...layout.source, id: '1:90' } })
    graph.updateNode(slot.id, { source: { ...slot.source, id: '1:96' } })
    graph.updateNode(content.id, { source: { ...content.source, id: '1:101' } })

    const instance = graph.createInstance(layout.id, page.id)
    if (!instance) throw new Error('failed to create layout instance')
    graph.updateNode(instance.id, {
      source: {
        ...instance.source,
        id: '1:99',
        fig: {
          ...instance.source.fig,
          symbolOverrides: [
            {
              guidPath: { guids: [{ sessionID: 1, localID: 101 }] },
              fillPaints: [
                {
                  type: 'SOLID',
                  color: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
                  opacity: 1,
                  visible: true,
                  blendMode: 'NORMAL'
                }
              ]
            }
          ],
          componentPropAssignments: [
            {
              defID: { sessionID: 1, localID: 100 },
              varValue: {
                value: {
                  slotContentIdValue: { guid: { sessionID: 1, localID: 101 } }
                }
              }
            }
          ]
        }
      }
    })

    const slotCopy = graph.getChildren(instance.id)[0]
    graph.updateNode(instance.id, {
      componentPropertyAssignments: { '1:100': content.id },
      invalidatedOverrideComponentIds: [content.id]
    })
    const placed = graph.createInstance(content.id, slotCopy.id)
    if (!placed) throw new Error('failed to place slot content')

    const exported = await exportFigFile(graph)
    const reloaded = await parseFigFile(exported.buffer as ArrayBuffer)
    const reloadedLayout = [...reloaded.getAllNodes()].find(
      (node) => node.type === 'COMPONENT' && node.name === 'Layout'
    )
    const reloadedInstance = [...reloaded.getAllNodes()].find(
      (node) => node.type === 'INSTANCE' && node.componentId === reloadedLayout?.id
    )
    const reloadedSlot = reloadedInstance ? reloaded.getChildren(reloadedInstance.id)[0] : undefined
    const reloadedContent = reloadedSlot ? reloaded.getChildren(reloadedSlot.id)[0] : undefined

    expect(reloadedContent?.fills[0]?.color).toEqual(RED)
  })
})
