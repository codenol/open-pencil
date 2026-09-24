import * as v from 'valibot'

import { toolNumber, nodeIdInput, nodeInput } from '#core/tools/input'
import { defineTool, nodeNotFound, nodeSummary } from '#core/tools/schema'

export const deleteNode = defineTool({
  name: 'delete_node',

  description: 'Delete a node by ID.',
  execution: { kind: 'sync', mutation: 'document' },
  input: v.object({
    id: v.pipe(v.string(), v.description('Node ID to delete'))
  }),
  execute: (figma, { id }) => {
    const node = figma.getNodeById(id)
    if (!node) return { error: `Node "${id}" not found` }
    node.remove()
    return { deleted: id }
  }
})

export const cloneNode = defineTool({
  name: 'clone_node',

  description:
    'Clone (duplicate) a node. The clone is autonomous: links back into an instance master are dropped, so a cloned slot or frame becomes your own node that saves edits.',
  execution: { kind: 'sync', mutation: 'document' },
  input: v.object({
    id: v.pipe(v.string(), v.description('Node ID to clone'))
  }),
  execute: (figma, { id }) => {
    const node = figma.getNodeById(id)
    if (!node) return { error: `Node "${id}" not found` }

    // Клон копии внутри инстанса не должен остаться внутри него: дети инстанса
    // в файл не пишутся, и клон пропадёт при сохранении. Такой клон кладём на
    // текущую страницу — он становится самостоятельным узлом.
    const raw = figma.graph.getNode(id)
    let insideInstance = Boolean(raw?.componentId)
    let cursor = raw?.parentId ? figma.graph.getNode(raw.parentId) : undefined
    while (!insideInstance && cursor) {
      if (cursor.type === 'INSTANCE') insideInstance = true
      cursor = cursor.parentId ? figma.graph.getNode(cursor.parentId) : undefined
    }

    const clone = node.clone()
    if (insideInstance) {
      const page = figma.currentPage
      figma.graph.reparentNode(clone.id, page.id)
    }

    // Клон копии из инстанса не должен ссылаться на мастера: иначе правки
    // клона уйдут в чужой мастер или пропадут при сохранении. Связь с мастером
    // остаётся только у настоящих инстансов (они несут её осмысленно).
    const dropMasterLinks = (nodeId: string) => {
      const entry = figma.graph.getNode(nodeId)
      if (!entry) return
      if (entry.type !== 'INSTANCE') {
        figma.graph.updateNode(nodeId, {
          ...(entry.componentId ? { componentId: null } : {}),
          ...(entry.componentPropertyReferences?.length ? { componentPropertyReferences: [] } : {})
        })
      }
      for (const childId of entry.childIds) dropMasterLinks(childId)
    }
    dropMasterLinks(clone.id)
    return nodeSummary(figma.getNodeById(clone.id) ?? clone)
  }
})

export const renameNode = defineTool({
  name: 'rename_node',

  description: 'Rename a node in the layers panel.',
  execution: { kind: 'sync', mutation: 'document' },
  input: v.object({
    id: nodeIdInput,
    name: v.pipe(v.string(), v.description('New name'))
  }),
  execute: (figma, { id, name }) => {
    const node = figma.getNodeById(id)
    if (!node) return { error: `Node "${id}" not found` }
    node.name = name
    return { id, name }
  }
})

export const nodeBounds = defineTool({
  name: 'node_bounds',
  description: 'Get absolute bounding box of a node.',
  execution: { kind: 'sync', mutation: 'none' },
  exposure: { webmcp: false },
  input: nodeInput,
  execute: (figma, { id }) => {
    const node = figma.getNodeById(id)
    return node ? { id, bounds: node.absoluteBoundingBox } : nodeNotFound(id)
  }
})

export const nodeMove = defineTool({
  name: 'node_move',

  description: 'Move a node to new coordinates.',
  execution: { kind: 'sync', mutation: 'document' },
  input: v.object({
    id: nodeIdInput,
    x: toolNumber(v.pipe(v.number(), v.description('X position'))),
    y: toolNumber(v.pipe(v.number(), v.description('Y position')))
  }),
  execute: (figma, { id, x, y }) => {
    const node = figma.getNodeById(id)
    if (!node) return nodeNotFound(id)
    node.x = x
    node.y = y
    return { id, x, y }
  }
})

export const nodeResize = defineTool({
  name: 'node_resize',

  description: 'Resize a node.',
  execution: { kind: 'sync', mutation: 'document' },
  input: v.object({
    id: nodeIdInput,
    width: toolNumber(v.pipe(v.number(), v.minValue(1), v.description('Width'))),
    height: toolNumber(v.pipe(v.number(), v.minValue(1), v.description('Height')))
  }),
  execute: (figma, { id, width, height }) => {
    const node = figma.getNodeById(id)
    if (!node) return nodeNotFound(id)
    node.resize(width, height)
    return { id, width, height }
  }
})
