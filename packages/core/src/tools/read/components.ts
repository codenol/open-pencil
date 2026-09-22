import * as v from 'valibot'

import { describeCapabilities, type ComponentCapabilities } from '#core/tools/capabilities'
import { getComponentCatalog } from '#core/tools/component-catalog'
import { toolNumber } from '#core/tools/input'
import { defineTool } from '#core/tools/schema'
import { resolveDefaultVariant } from '#core/tools/default-variant'

/**
 * Правила компонента, поднятые из pluginData. Краткая форма идёт в поиск:
 * одна строка про назначение и ключевой запрет. Полная — при вставке.
 */
interface ComponentRulesSummary {
  purpose: string
  mustNot: string
}

const RULES_PLUGIN_ID = 'norka.design-system'

/** Минимум, который нужен от узла, чтобы достать правила. */
interface ComponentRulesHolder {
  pluginData?: readonly { pluginId: string; key: string; value: string }[]
}
const RULES_KEY = 'component-rules'

/** Краткая выжимка правил: назначение и первый запрет — самое важное. */
function summarizeRules(node: ComponentRulesHolder | undefined): ComponentRulesSummary | null {
  const entry = node?.pluginData?.find(
    (item) => item.pluginId === RULES_PLUGIN_ID && item.key === RULES_KEY
  )
  if (!entry) return null
  try {
    const parsed = JSON.parse(entry.value) as { purpose?: unknown; forbidden?: unknown }
    const purpose = typeof parsed.purpose === 'string' ? parsed.purpose : ''
    const forbidden = Array.isArray(parsed.forbidden)
      ? parsed.forbidden.filter((item): item is string => typeof item === 'string')
      : []
    if (!purpose && forbidden.length === 0) return null
    return { purpose, mustNot: forbidden[0] ?? '' }
  } catch {
    return null
  }
}

interface DocumentComponentResult {
  id: string
  name: string
  type: string
  page: string
  source: 'document'
  /** Что с компонентом можно сделать: виды, размеры, состояния. */
  capabilities?: ComponentCapabilities
  /** Правила компонента — ассистент обязан их соблюдать. */
  rules?: ComponentRulesSummary
}

interface LibraryComponentResult {
  libraryId: string
  libraryName: string
  revisionId: string
  assetKey: string
  name: string
  type: string
  description: string
  source: 'library'
  enabled: boolean
  priority: number
}

/** Сколько компонентов показываем в обзоре: хватает, чтобы спланировать. */
const OVERVIEW_LIMIT = 60

export const getComponents = defineTool({
  name: 'get_components',
  description:
    'List reusable components with what they can do (variants, sizes, sentiments). Use `overview` to see everything at once before planning — it replaces a series of separate searches. Components may carry rules (purpose, mustNot) — obey them when using the component.',
  execution: { kind: 'async', mutation: 'none' },
  input: v.object({
    overview: v.optional(
      v.pipe(
        v.boolean(),
        v.description(
          'Return a compact overview of all components: name, capabilities, default variant. Use this once before planning a composition instead of several searches.'
        )
      ),
      false
    ),
    name: v.optional(
      v.pipe(v.string(), v.description('Filter by name (case-insensitive substring)'))
    ),
    source: v.optional(
      v.pipe(v.picklist(['all', 'document', 'libraries']), v.description('Component source')),
      'all'
    ),
    library_id: v.optional(
      v.pipe(v.string(), v.description('Filter library components by library ID'))
    ),
    limit: v.optional(
      toolNumber(
        v.pipe(v.number(), v.integer(), v.minValue(0), v.description('Max results (default: 50)'))
      )
    )
  }),
  execute: async (figma, args) => {
    const limit = args.limit ?? 50
    const source = args.source
    const nameFilter = args.name?.toLowerCase()
    const documentComponents: DocumentComponentResult[] = []

    if (source !== 'libraries') {
      for (const page of figma.root.children) {
        if (documentComponents.length >= limit) break
        page.findAll((node) => {
          if (documentComponents.length >= limit) return false
          if (node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET') return false
          if (nameFilter && !node.name.toLowerCase().includes(nameFilter)) return false
          const rules = summarizeRules(figma.graph.getNode(node.id))
          const capabilities = describeCapabilities(figma.graph, node.id) ?? undefined
          documentComponents.push({
            id: node.id,
            name: node.name,
            type: node.type,
            page: page.name,
            source: 'document',
            ...(capabilities ? { capabilities } : {}),
            ...(rules ? { rules } : {})
          })
          return false
        })
      }
    }

    const catalog = getComponentCatalog(figma.graph)
    const libraryComponents: LibraryComponentResult[] = []
    if (source !== 'document' && catalog) {
      const assets = await catalog.listComponents({
        name: args.name,
        libraryId: args.library_id,
        enabledOnly: true
      })
      libraryComponents.push(
        ...assets.map(({ libraryId, libraryName, revisionId, enabled, priority, asset }) => ({
          libraryId,
          libraryName,
          revisionId,
          assetKey: asset.key,
          name: asset.name,
          type: asset.type,
          description: asset.description,
          source: 'library' as const,
          enabled,
          priority
        }))
      )
    }

    const components = [...libraryComponents, ...documentComponents]
      .sort((left, right) => {
        const leftPriority = 'priority' in left ? left.priority : -1
        const rightPriority = 'priority' in right ? right.priority : -1
        return rightPriority - leftPriority || left.name.localeCompare(right.name)
      })
      .slice(0, args.overview ? OVERVIEW_LIMIT : limit)

    if (!args.overview) return { count: components.length, components }

    // Обзор: по каждому компоненту — имя, возможности и базовый вариант.
    // Одного вызова хватает, чтобы составить план: не нужно искать по частям
    // и разбирать каждый компонент отдельно.
    const overviewItems = components.map((component) => {
      const id = 'id' in component ? component.id : null
      const variant = id ? resolveDefaultVariant(figma.graph, id) : null
      return {
        name: component.name,
        ...(id ? { id } : {}),
        ...('libraryId' in component ? { libraryId: component.libraryId } : {}),
        ...('assetKey' in component ? { assetKey: component.assetKey } : {}),
        ...('page' in component ? { page: component.page } : {}),
        ...('capabilities' in component && component.capabilities
          ? {
              variants: component.capabilities.variantCount,
              can: component.capabilities.summary
            }
          : {}),
        ...(variant ? { defaultVariant: variant.variantName } : {})
      }
    })
    return { count: overviewItems.length, overview: true, components: overviewItems }
  }
})
