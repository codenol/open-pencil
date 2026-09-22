import * as v from 'valibot'

import type { SceneGraph } from '@open-pencil/scene-graph'

import { defineTool } from '#core/tools/schema'

/**
 * Список иконок дизайн-системы.
 *
 * Ассистент ищет иконку и не находит: набор `icon` держит только размеры
 * (12, 16, 20, 24), а сами иконки лежат отдельными компонентами по
 * категориям. Не зная имён, он пробует наугад, разбирает существующие через
 * eval и в итоге рисует иконку сам — мимо системы.
 *
 * Здесь отдаём перечень имён по категориям: короткий, без дерева. По нему
 * видно, есть ли нужная иконка, и что брать вместо отсутствующей.
 */

/** Сколько имён показываем без уточнения. */
const DEFAULT_LIMIT = 400

export const listIcons = defineTool({
  name: 'list_icons',
  description:
    'List icon names available in the design system, grouped by category. Use it before placing an icon: if the name is here, insert that component; if it is not, say so instead of drawing the glyph. Accepts a filter to narrow the list.',
  execution: { kind: 'sync', mutation: 'none' },
  input: v.object({
    filter: v.optional(
      v.pipe(v.string(), v.description('Only names containing this text (case-insensitive)'))
    ),
    limit: v.optional(
      v.pipe(v.number(), v.description(`Max names to return (default: ${DEFAULT_LIMIT})`))
    )
  }),
  execute: (figma, args) => {
    const filter = args.filter?.toLowerCase()
    const limit = args.limit ?? DEFAULT_LIMIT
    const groups = collectIcons(figma.graph)

    const matched: Array<{ name: string; category: string; id: string }> = []
    for (const group of groups) {
      for (const icon of group.icons) {
        if (filter && !icon.name.toLowerCase().includes(filter)) continue
        matched.push({ name: icon.name, category: group.category, id: icon.id })
      }
    }

    const shown = matched.slice(0, limit)
    const categories = [...new Set(shown.map((icon) => icon.category))].sort()

    return {
      count: matched.length,
      shown: shown.length,
      categories,
      icons: shown,
      ...(matched.length > shown.length
        ? { note: `Showing first ${shown.length} of ${matched.length}. Narrow with filter.` }
        : {}),
      ...(matched.length === 0
        ? {
            note:
              'No icon matches. The glyph is not in the design system: name the missing one in the answer instead of drawing it by hand.'
          }
        : {})
    }
  }
})

interface IconGroup {
  category: string
  icons: Array<{ id: string; name: string }>
}

/**
 * Собирает иконки по категориям.
 *
 * Иконки лежат на странице с разделами-категориями, каждый — фрейм с
 * компонентами внутри. Плоский перечень имён без дерева: ассистенту нужно
 * знать, что есть, а не как это устроено.
 */
function collectIcons(graph: SceneGraph): IconGroup[] {
  const groups: IconGroup[] = []
  for (const page of graph.getPages(true)) {
    // Иконки живут на своей странице; на остальных лежат компоненты системы,
    // и они в этот перечень не входят.
    if (!/^icons?$/i.test(page.name.trim())) continue
    for (const sectionId of page.childIds) {
      const section = graph.getNode(sectionId)
      if (!section) continue
      const icons = collectIconComponents(graph, section.id)
      if (icons.length > 0) {
        groups.push({ category: section.name.trim(), icons })
      }
    }
  }
  return groups
}

/** Компоненты-иконки внутри раздела, включая вложенные. */
function collectIconComponents(
  graph: SceneGraph,
  rootId: string
): Array<{ id: string; name: string }> {
  const found: Array<{ id: string; name: string }> = []
  const queue = [rootId]
  const seen = new Set<string>()
  while (queue.length > 0) {
    const id = queue.shift()
    if (id === undefined || seen.has(id)) continue
    seen.add(id)
    const node = graph.getNode(id)
    if (!node) continue
    if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
      const name = node.name.trim()
      // Имя вида «fi:chevron-right» или «u:home»: берём читаемую часть.
      if (name && !name.includes('=')) {
        found.push({ id: node.id, name: name.replace(/^[a-z]{2}:/i, '') })
      }
    }
    for (const childId of node.childIds) queue.push(childId)
  }
  return found
}
