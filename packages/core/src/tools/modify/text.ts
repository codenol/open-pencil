import * as v from 'valibot'

import type { CharacterStyleOverride, SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { parseColor } from '#core/color'
import { styleToWeight } from '#core/text/fonts'
import { applyStyleToRange } from '#core/text/style-runs'
import { toolNumber, nodeIdInput } from '#core/tools/input'
import { computeAllLayouts, estimateTextSize } from '#core/layout'
import { defineTool, nodeNotFound } from '#core/tools/schema'

export const setText = defineTool({
  name: 'set_text',

  description: 'Set text content of a text node.',
  execution: { kind: 'sync', mutation: 'properties' },
  input: v.object({
    id: nodeIdInput,
    text: v.pipe(v.string(), v.description('Text content'))
  }),
  execute: (figma, { id, text }) => {
    const raw = figma.graph.getNode(id)
    if (!raw) return { error: `Node "${id}" not found` }

    // У инстанса текст живёт в дочернем узле, а не в нём самом: запись в сам
    // экземпляр проходит, но её никто не рисует — выглядит как успех, а на
    // деле ничего не меняется. Поэтому сами находим текстовый узел внутри.
    if (raw.type === 'INSTANCE') {
      const target = firstTextNode(figma.graph, raw.id)
      if (!target) {
        return {
          error: `Instance "${id}" has no text node inside — nothing to set. Put a label into a component that has one, or use a component whose text you can change.`
        }
      }
      figma.graph.updateNode(target.id, { text, ...autoResizePatch(target, text) })
      // Текст изменился — размеры вокруг него надо пересчитать. Без этого
      // бейдж или кнопка с шириной «по содержимому» остаются прежними:
      // HUG не срабатывает, потому что раскладку никто не запускал.
      const scope = layoutScope(figma.graph, target.id)
      if (scope) computeAllLayouts(figma.graph, scope)
      return { id: target.id, instanceId: id, text }
    }

    if (raw.type !== 'TEXT') {
      return { error: `Node "${id}" is ${raw.type}, not a text node or instance` }
    }
    figma.graph.updateNode(id, { text, ...autoResizePatch(raw, text) })
    const scope = layoutScope(figma.graph, id)
    if (scope) computeAllLayouts(figma.graph, scope)
    return { id, text }
  }
})

/** Первый текстовый узел внутри поддерева. */
function firstTextNode(graph: SceneGraph, rootId: string): SceneNode | null {
  const queue = [rootId]
  while (queue.length > 0) {
    const id = queue.shift()
    if (id === undefined) break
    for (const childId of graph.getNode(id)?.childIds ?? []) {
      const child = graph.getNode(childId)
      if (!child) continue
      if (child.type === 'TEXT') return child
      queue.push(childId)
    }
  }
  return null
}

/** Размер текста после смены содержимого. */
function autoResizePatch(node: SceneNode, text: string): Partial<SceneNode> {
  if (node.textAutoResize === 'NONE' || node.textAutoResize === 'TRUNCATE') return {}
  const measured = estimateTextSize({ ...node, text }, node.textAutoResize === 'HEIGHT' ? node.width : undefined)
  return node.textAutoResize === 'HEIGHT'
    ? { height: measured.height }
    : { width: measured.width, height: measured.height }
}

export const setFont = defineTool({
  name: 'set_font',

  description: 'Set font properties of a text node.',
  execution: { kind: 'sync', mutation: 'properties' },
  input: v.object({
    id: nodeIdInput,
    family: v.optional(v.pipe(v.string(), v.description('Font family name'))),
    size: v.optional(toolNumber(v.pipe(v.number(), v.minValue(1), v.description('Font size')))),
    style: v.optional(
      v.pipe(v.string(), v.description('Font style (e.g. "Bold", "Regular", "Bold Italic")'))
    )
  }),
  execute: (figma, args) => {
    const node = figma.getNodeById(args.id)
    if (!node) return nodeNotFound(args.id)
    if (args.size !== undefined) node.fontSize = args.size
    if (args.family || args.style) {
      const current = node.fontName
      node.fontName = {
        family: args.family ?? current.family,
        style: args.style ?? current.style
      }
    }
    return { id: args.id, fontName: node.fontName, fontSize: node.fontSize }
  }
})

export const setFontRange = defineTool({
  name: 'set_font_range',

  description: 'Set font properties for a text range.',
  execution: { kind: 'sync', mutation: 'properties' },
  input: v.object({
    id: nodeIdInput,
    start: toolNumber(v.pipe(v.number(), v.minValue(0), v.description('Start character index'))),
    end: toolNumber(v.pipe(v.number(), v.minValue(0), v.description('End character index'))),
    family: v.optional(v.pipe(v.string(), v.description('Font family name'))),
    size: v.optional(toolNumber(v.pipe(v.number(), v.minValue(1), v.description('Font size')))),
    style: v.optional(v.pipe(v.string(), v.description('Font style'))),
    color: v.optional(v.pipe(v.string(), v.description('Text color (hex)')))
  }),
  execute: (figma, args) => {
    const node = figma.getNodeById(args.id)
    if (!node) return nodeNotFound(args.id)
    const override: CharacterStyleOverride = {}
    if (args.family) override.fontFamily = args.family
    if (args.size) override.fontSize = args.size
    if (args.style) {
      const s = args.style.toLowerCase()
      if (s.includes('italic')) override.italic = true
      override.fontWeight = styleToWeight(args.style)
    }
    if (args.color) {
      override.fills = [{ type: 'SOLID', color: parseColor(args.color), opacity: 1, visible: true }]
    }
    const raw = figma.graph.getNode(node.id)
    if (!raw) return { error: `Node "${args.id}" not found` }
    const runs = applyStyleToRange(raw.styleRuns, args.start, args.end, override, raw.text.length)
    figma.graph.updateNode(node.id, { styleRuns: runs })
    return { id: args.id, range: { start: args.start, end: args.end } }
  }
})

export const setTextResize = defineTool({
  name: 'set_text_resize',

  description: 'Set text auto-resize mode.',
  execution: { kind: 'sync', mutation: 'properties' },
  input: v.object({
    id: nodeIdInput,
    mode: v.pipe(
      v.picklist(['NONE', 'WIDTH_AND_HEIGHT', 'HEIGHT', 'TRUNCATE']),
      v.description('Resize mode')
    )
  }),
  execute: (figma, { id, mode }) => {
    const node = figma.getNodeById(id)
    if (!node) return { error: `Node "${id}" not found` }
    const raw = figma.graph.getNode(id)
    if (!raw) return { error: `Node "${id}" not found` }
    // Смена режима сама по себе размер не пересчитывает: узел остаётся
    // с прежней шириной, и раскладка вокруг него врёт. Считаем размер сразу.
    const sized = applyTextAutoResize(raw, mode)
    return { id, textAutoResize: mode, ...sized }
  }
})

/** Ближайший предок с раскладкой: его и пересчитываем. */
export function layoutScope(graph: SceneGraph, nodeId: string): string | null {
  let current = graph.getNode(nodeId)?.parentId ? graph.getNode(graph.getNode(nodeId)!.parentId!) : null
  while (current) {
    if (current.layoutMode !== 'NONE') return current.id
    current = current.parentId ? graph.getNode(current.parentId) : undefined
  }
  return null
}

/**
 * Приводит размер текста в соответствие с режимом.
 *
 * С 'WIDTH_AND_HEIGHT' ширина и высота идут от содержимого, с 'HEIGHT' —
 * ширина задана, высота от содержимого. Считаем через измерение текста:
 * в агентском режиме рендерера нет, поэтому идём через OpenType, а он
 * доступен всегда.
 */
function applyTextAutoResize(
  node: SceneNode,
  mode: 'NONE' | 'WIDTH_AND_HEIGHT' | 'HEIGHT' | 'TRUNCATE'
): { width?: number; height?: number } {
  node.textAutoResize = mode
  if (mode === 'NONE' || mode === 'TRUNCATE') return {}
  if (mode === 'HEIGHT') {
    const measured = estimateTextSize(node, node.width)
    return { height: measured.height }
  }
  const measured = estimateTextSize(node)
  return { width: measured.width, height: measured.height }
}

export const setTextProperties = defineTool({
  name: 'set_text_properties',

  description:
    'Set text layout properties: alignment, auto-resize, text case, decoration, truncation.',
  execution: { kind: 'sync', mutation: 'properties' },
  input: v.object({
    id: v.pipe(v.string(), v.description('Text node ID')),
    align_horizontal: v.optional(
      v.pipe(
        v.picklist(['LEFT', 'CENTER', 'RIGHT', 'JUSTIFIED']),
        v.description('Horizontal text alignment')
      )
    ),
    align_vertical: v.optional(
      v.pipe(v.picklist(['TOP', 'CENTER', 'BOTTOM']), v.description('Vertical text alignment'))
    ),
    auto_resize: v.optional(
      v.pipe(
        v.picklist(['NONE', 'WIDTH_AND_HEIGHT', 'HEIGHT', 'TRUNCATE']),
        v.description('Text auto-resize mode')
      )
    ),
    direction: v.optional(
      v.pipe(v.picklist(['AUTO', 'LTR', 'RTL']), v.description('Text direction'))
    ),
    text_decoration: v.optional(
      v.pipe(v.picklist(['NONE', 'UNDERLINE', 'STRIKETHROUGH']), v.description('Text decoration'))
    )
  }),
  execute: (figma, args) => {
    const node = figma.getNodeById(args.id)
    if (!node) return nodeNotFound(args.id)
    if (node.type !== 'TEXT') return { error: `Node "${args.id}" is not a TEXT node` }
    const updated: string[] = []
    if (args.align_horizontal !== undefined) {
      node.textAlignHorizontal = args.align_horizontal
      updated.push('textAlignHorizontal')
    }
    if (args.align_vertical !== undefined) {
      node.textAlignVertical = args.align_vertical
      updated.push('textAlignVertical')
    }
    if (args.auto_resize !== undefined) {
      node.textAutoResize = args.auto_resize
      updated.push('textAutoResize')
    }
    if (args.direction !== undefined) {
      node.textDirection = args.direction as SceneNode['textDirection']
      updated.push('textDirection')
    }
    if (args.text_decoration !== undefined) {
      node.textDecoration = args.text_decoration
      updated.push('textDecoration')
    }
    return { id: args.id, updated }
  }
})
