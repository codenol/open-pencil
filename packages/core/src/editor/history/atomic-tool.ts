import {
  captureScopedCheckpoint,
  scopedChanges,
  type SceneGraph,
  type SceneNode
} from '@open-pencil/scene-graph'

import type { Editor } from '#core/editor/create'
import type { FigmaAPI } from '#core/figma-api'
import { isAtomicTool, type ToolDef } from '#core/tools/schema'

/** Снимок узла: какие свойства были до правки. */
type ScopedChange = { id: string; before: Partial<SceneNode>; after: Partial<SceneNode> }

/** Поля структуры: их точечная правка менять не вправе. */
const STRUCTURE_FIELDS: string[] = ['id', 'type', 'parentId', 'childIds', 'componentId']

type MutationEditor = Pick<Editor, 'graph' | 'runLayoutForNode' | 'requestRender' | 'pushUndoEntry'>


/**
 * Какие узлы инструмент собирается изменить.
 *
 * Инструмент называет цель в аргументах: `id`, `node_id`, `ids`. Если цели
 * нет (работа по выделению), снимаем выделенные.
 */
function targetIds(figma: FigmaAPI, args: Record<string, unknown>): string[] {
  const collected: string[] = []
  for (const key of ['id', 'node_id', 'nodeId', 'ids', 'node_ids']) {
    const value = args[key]
    if (typeof value === 'string') collected.push(value)
    else if (Array.isArray(value)) collected.push(...value.filter((v) => typeof v === 'string'))
  }
  for (const key of ['source_id', 'target_id']) {
    const value = args[key]
    if (typeof value === 'string') collected.push(value)
  }
  if (collected.length === 0) {
    const selection = figma.currentPage?.selection ?? []
    collected.push(...selection.map((node) => node.id))
  }
  return collected
}

/**
 * No await is permitted between snapshot and commit. Browser events, other agents and
 * cancellation cannot interleave with this bounded transaction. Async tools use their
 * existing execution path and are not exposed through WebMCP.
 */
export function executeAtomicTool(
  editor: MutationEditor,
  figma: FigmaAPI,
  def: ToolDef,
  args: Record<string, unknown>,
  options: { signal?: AbortSignal; isLive?: () => boolean; label?: string } = {}
): unknown {
  if (!isAtomicTool(def)) throw new Error(`Not an atomic tool: ${def.name}`)
  options.signal?.throwIfAborted()
  if (editor.graph !== figma.graph || options.isLive?.() === false) {
    throw new Error('The target document is no longer open')
  }
  const graph = figma.graph
  const pageId = figma.currentPageId

  // Снимаем только те узлы, которые инструмент собирается менять.
  // Общий снимок графа копировал весь документ целиком — на дизайн-системе
  // это десятки тысяч объектов ради изменения заливки, поэтому для больших
  // документов правки просто запрещались. Точечный снимок снимает запрет:
  // структуру инструмент и так менять не вправе.
  const checkpoint = captureScopedCheckpoint(graph, targetIds(figma, args))

  const replay = (nodeChanges: ScopedChange[], direction: 'before' | 'after') => {
    if (editor.graph !== graph) throw new Error('The target document has been replaced')
    graph.preserveSourceMetadataDuring(() => {
      for (const change of nodeChanges) {
        const node = graph.getNode(change.id)
        if (!node) continue
        const values = change[direction]
        for (const key of Object.keys(node) as (keyof SceneNode)[]) {
          if (!(key in values) && !STRUCTURE_FIELDS.includes(key)) {
            Reflect.deleteProperty(node, key)
          }
        }
        Object.assign(node, structuredClone(values))
      }
    })
    layout(
      graph,
      editor,
      pageId,
      false,
      nodeChanges.map((change) => change.id)
    )
    editor.requestRender()
  }

  try {
    const result = def.execute(figma, args)
    if (result instanceof Promise) throw new Error('Atomic tools must execute synchronously')
    if (result && typeof result === 'object' && 'error' in result) {
      throw new Error(String(result.error))
    }
    if (!checkpoint.structureIntact()) {
      throw new Error('Atomic tools must not change node hierarchy or identity')
    }
    const nodeChanges = scopedChanges(graph, checkpoint)
    const contentChanged = nodeChanges.some((change) =>
      Object.keys(change.after).some((key) => key !== 'source')
    )
    if (!contentChanged && nodeChanges.length) replay(nodeChanges, 'before')
    if (contentChanged) {
      editor.pushUndoEntry({
        label: `${options.label ?? 'Agent'}: ${def.name}`,
        inverse: () => replay(nodeChanges, 'before'),
        forward: () => replay(nodeChanges, 'after')
      })
      editor.requestRender()
    }
    return result
  } catch (error) {
    checkpoint.restore()
    editor.requestRender()
    throw error
  }
}

function layout(
  graph: SceneGraph,
  editor: MutationEditor,
  pageId: string,
  allPages: boolean,
  changedIds: string[]
): void {
  const scopes = new Set(allPages ? graph.getPages().map((page) => page.id) : [pageId])
  for (const id of changedIds) {
    let node = graph.getNode(id)
    while (node && node.type !== 'CANVAS')
      node = node.parentId ? graph.getNode(node.parentId) : undefined
    if (node) scopes.add(node.id)
  }
  for (const id of scopes) editor.runLayoutForNode(id)
}
