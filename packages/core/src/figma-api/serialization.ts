import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { childSlots, isSlotNode, SLOT_HINT } from '#core/tools/slots'
import type { NodeProxyHost } from './proxy'

/**
 * Сколько детей показывать у крупного узла.
 *
 * Компонентный сет держит десятки и сотни вариантов. Полный список не нужен:
 * ассистенту важно строение и возможности, а не все копии. Остаток сообщаем
 * числом, чтобы он мог спросить конкретное, если понадобится.
 */
const CHILDREN_LIMIT = 24

function resolveBindings(graph: SceneGraph, node: SceneNode): Record<string, unknown> | undefined {
  const keys = Object.keys(node.boundVariables)
  if (keys.length === 0) return undefined
  const result: Record<string, unknown> = {}
  for (const [field, varId] of Object.entries(node.boundVariables)) {
    const variable = graph.variables.get(varId)
    result[field] = {
      variableId: varId,
      variableName: variable?.name ?? varId,
      resolvedValue: variable ? graph.resolveVariable(varId) : undefined
    }
  }
  return result
}

function appendTextProps(obj: Record<string, unknown>, n: SceneNode): void {
  obj.fontFamily = n.fontFamily
  obj.fontSize = n.fontSize
  obj.fontWeight = n.fontWeight
  obj.italic = n.italic
  obj.textAlignHorizontal = n.textAlignHorizontal
  obj.textAlignVertical = n.textAlignVertical
  obj.textAutoResize = n.textAutoResize
  obj.textDirection = n.textDirection
  if (n.lineHeight != null) obj.lineHeight = n.lineHeight
  if (n.letterSpacing !== 0) obj.letterSpacing = n.letterSpacing
  if (n.textCase !== 'ORIGINAL') obj.textCase = n.textCase
  if (n.textDecoration !== 'NONE') obj.textDecoration = n.textDecoration
  if (n.maxLines != null) obj.maxLines = n.maxLines
}

export function nodeProxyToJSON(
  graph: SceneGraph,
  api: NodeProxyHost,
  nodeId: string,
  maxDepth?: number,
  currentDepth = 0
): Record<string, unknown> {
  const n = graph.getNode(nodeId)
  if (!n) return { id: nodeId, removed: true }

  // Узел внутри инстанса — это переопределение: его можно менять и наполнять,
  // связь с компонентом при этом сохраняется. Без подсказки ассистент тратит
  // пробный рендер, чтобы выяснить это опытным путём.
  const insideInstance = isInsideInstance(graph, n)

  const obj: Record<string, unknown> = {
    id: n.id,
    type: n.type,
    name: n.name,
    x: n.x,
    y: n.y,
    width: n.width,
    height: n.height
  }
  if (n.fills.length > 0) obj.fills = n.fills
  if (n.strokes.length > 0) obj.strokes = n.strokes
  if (n.effects.length > 0) obj.effects = n.effects
  if (n.opacity !== 1) obj.opacity = n.opacity
  if (n.cornerRadius > 0) obj.cornerRadius = n.cornerRadius
  if (!n.visible) obj.visible = false
  if (n.text) obj.characters = n.text
  if (n.type === 'TEXT') {
    appendTextProps(obj, n)
  }
  if (n.layoutMode !== 'NONE') {
    obj.layoutMode = n.layoutMode
    obj.layoutDirection = n.layoutDirection
    obj.itemSpacing = n.itemSpacing
  }
  // Include variable bindings with resolved values
  const bindings = resolveBindings(graph, n)
  if (bindings) obj.boundVariables = bindings
  const children = graph.getChildren(nodeId)
  if (children.length > 0) {
    if (maxDepth !== undefined && currentDepth >= maxDepth) {
      obj.childCount = children.length
    } else if (children.length > CHILDREN_LIMIT) {
      // Сет вроде button держит 900 вариантов: их полный разбор — это сотни
      // килобайт в ответ, и контекст забивается за один шаг. Отдаём первые
      // варианты и говорим, сколько осталось.
      obj.children = children
        .slice(0, CHILDREN_LIMIT)
        .map((child) => api.wrapNode(child.id).toJSON(maxDepth, currentDepth + 1))
      obj.childCount = children.length
      obj.childrenShown = CHILDREN_LIMIT
      obj.note =
        `Shown the first ${CHILDREN_LIMIT} of ${children.length} children. ` +
        'For a component set use the variant list from get_components instead of reading each one: the names carry the properties, and one variant can be read by id if its structure matters.'
    } else {
      obj.children = children.map((child) =>
        api.wrapNode(child.id).toJSON(maxDepth, currentDepth + 1)
      )
    }
  }
  if (insideInstance) {
    obj.insideInstance = true
    // Раньше здесь стоял запрет: «новые узлы не сохранятся». Он устарел и
    // работал во вред: ассистент читал его, решал, что действовать нельзя, и
    // останавливался, ничего не сделав. Теперь правки уводятся в мастер сами,
    // поэтому вместо запрета — что именно произойдёт.
    obj.editable =
      'Existing children of an instance keep their overrides (text, fills, properties). ' +
      'New nodes added straight into an instance are not written to the file. ' +
      'This is handled for you: a container marked as a place goes to its master ' +
      'and the content is saved there — just render or fill as usual.'
  }
  // Пометка слота: унаследованная метка в pluginData или настоящее свойство
  // типа SLOT — любой контейнер с ними наполняется готовым блоком, а не
  // узлами напрямую.
  if (isSlotNode(graph, n)) {
    obj.slot = true
    // Где слот: в мастере или в рабочей копии. Без этого ассистент путался,
    // какой узел он видит, и уходил править мастер вместо своей страницы.
    const scope = slotScopeOf(graph, nodeId)
    obj.slotScope = scope
    if (n.childIds.length === 0) {
      obj.slotHint =
        scope === 'master'
          ? `${SLOT_HINT} This one is in the master, so filling it changes the library for everyone.`
          : `${SLOT_HINT} This one is in a working copy: fill it the same way, and keep the master as it is.`
    }
  }
  const slots = childSlots(graph, nodeId)
  if (slots.length > 0) obj.slots = slots
  return obj
}

/** Где лежит узел с этой меткой: в мастере, в инстансе или на странице. */
function slotScopeOf(graph: SceneGraph, nodeId: string): 'master' | 'instance' | 'page' {
  let current = graph.getNode(nodeId)
  while (current?.parentId) {
    const parent = graph.getNode(current.parentId)
    if (!parent) break
    if (parent.type === 'COMPONENT' || parent.type === 'COMPONENT_SET') return 'master'
    if (parent.type === 'INSTANCE') return 'instance'
    current = parent
  }
  return 'page'
}

/** Лежит ли узел внутри инстанса (сам инстанс не считается). */
function isInsideInstance(graph: SceneGraph, node: { parentId: string | null }): boolean {
  let parentId = node.parentId
  while (parentId) {
    const parent = graph.getNode(parentId)
    if (!parent) return false
    if (parent.type === 'INSTANCE') return true
    parentId = parent.parentId
  }
  return false
}
