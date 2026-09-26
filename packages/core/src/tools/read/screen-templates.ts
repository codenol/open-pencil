import type { SceneNode } from '@open-pencil/scene-graph'

import * as v from 'valibot'

import type { FigmaAPI } from '#core/figma-api'
import { nodeIdInput } from '#core/tools/input'
import { defineTool } from '#core/tools/schema'
import {
  readScreenTemplate,
  resolveScreenTemplate,
  screenTemplateFrames
} from '#core/tools/screen-template'

/**
 * Эталоны экранов.
 *
 * Ассистент не должен собирать типовой экран заново: в документе лежат
 * собранные экраны-образцы с разбором — из чего они состоят, чем наполняются и
 * что в них менять нельзя. Эти два инструмента дают сначала список, потом
 * разбор одного образца со ссылками на узлы: по ним экран наполняют данными
 * обычными инструментами.
 */
export const listScreenTemplates = defineTool({
  name: 'list_screen_templates',
  description:
    'List the assembled screen templates of this document. A screen template is a finished screen kept as a reference: it carries the rules of the screen, its zones and columns. When the user asks for a screen that looks like an existing one, read the template first and build from it instead of composing the layout from scratch.',
  execution: { kind: 'sync', mutation: 'none' },
  exposure: { webmcp: false },
  input: v.object({}),
  execute: (figma) => {
    const frames = screenTemplateFrames(figma.graph)
    const templates = frames.map((frame) => {
      const template = readScreenTemplate(figma.graph, frame.id)
      const resolved = resolveScreenTemplate(figma.graph, frame.id)
      return {
        id: frame.id,
        name: frame.name.trim(),
        purpose: template?.purpose ?? '',
        columns: resolved?.columns.length ?? 0,
        rows: resolved?.rows.length ?? 0,
        slots: resolved?.slots.length ?? 0
      }
    })
    const note =
      templates.length === 0
        ? 'This document has no screen templates yet. Build the screen from the design-system components and their rules (get_node returns them).'
        : 'Call get_screen_template with the id of the template you are going to follow — it returns the live ids to fill.'
    return { count: templates.length, templates, note }
  }
})

export const getScreenTemplate = defineTool({
  name: 'get_screen_template',
  description:
    'Read one screen template: what the screen is for, when to take it and when not, its zones, its columns with the data field of each, the meaning-to-variant dictionary for statuses and badges, the slots and the blocks filling them, and the checks to run before handing the screen over. Live ids of the header, the row pattern and the cells let you fill the screen with data.',
  execution: { kind: 'sync', mutation: 'none' },
  exposure: { webmcp: false },
  input: v.object({ id: nodeIdInput }),
  execute: (figma, { id }) => {
    const node = figma.graph.getNode(id)
    if (!node) return { error: `Node "${id}" not found` }
    // Разбор ищем и у самого кадра, и у того, что внутри него: ассистент часто
    // знает только про выделенный узел.
    const frame = node.type === 'FRAME' ? node : ancestorFrame(figma, id)
    if (!frame) return { found: false, note: 'This node is not inside a screen template.' }
    const resolved = resolveScreenTemplate(figma.graph, frame.id)
    if (!resolved) return { found: false, note: `Frame "${frame.name.trim()}" carries no screen template.` }

    const { template } = resolved
    const sample = resolved.rows.at(0)
    const rows: Record<string, unknown> = {
      count: resolved.rows.length,
      ids: resolved.rows.map((row) => row.id)
    }
    if (sample) {
      rows.pattern = { id: sample.id, name: sample.name, cells: sample.cells }
    }
    const answer: Record<string, unknown> = {
      found: true,
      id: resolved.frame.id,
      name: resolved.frame.name,
      size: { width: resolved.frame.width, height: resolved.frame.height },
      columns: resolved.columns,
      rows,
      slots: resolved.slots,
      next: 'Fill the screen: set the text of the cell textId for each field, and pick the status or badge variant by meaning from statuses and badges. Repeat the row pattern for more records, add a separator between rows. Do not replace cells with frames or pick colours by eye.'
    }
    for (const key of ['purpose', 'use', 'avoid', 'zones', 'statuses', 'badges', 'allowed', 'forbidden', 'checks', 'issues'] as const) {
      const value = template[key]
      if (value !== undefined) answer[key] = value
    }
    return answer
  }
})

/** Кадр-эталон, внутри которого лежит узел: поднимаемся до кадра с разбором. */
function ancestorFrame(figma: FigmaAPI, id: string): SceneNode | undefined {
  let current = figma.graph.getNode(id)
  while (current?.parentId) {
    const parent = figma.graph.getNode(current.parentId)
    if (!parent) return undefined
    if (parent.type === 'FRAME') return parent
    current = parent
  }
  return undefined
}
