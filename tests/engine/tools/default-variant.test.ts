import { describe, expect, test } from 'bun:test'

import { markDefaultVariant, resolveDefaultVariant } from '@open-pencil/core/tools'

import { getNodeOrThrow } from '#tests/helpers/assert'
import { setupToolTest } from '#tests/helpers/tools'

const RULES_PLUGIN_ID = 'norka.design-system'
const DEFAULT_VARIANT_KEY = 'default-variant'

/**
 * Базовый вариант сета.
 *
 * Пометка хранит номер варианта, а номера узлов меняются при пересборке
 * документа: в живом файле пометка есть у всех наборов, но номер в ней мёртв.
 * Тогда решает имя варианта — оно остаётся прежним.
 */
function setupSet(variantNames: string[]) {
  const { graph } = setupToolTest()
  const page = graph.getPages()[0]
  const set = graph.createNode('COMPONENT_SET', page.id, { name: 'table cell' })
  const variants = variantNames.map((name) =>
    graph.createNode('COMPONENT', set.id, { name, width: 100, height: 40 })
  )
  return { graph, set, variants }
}

function writeMark(
  graph: ReturnType<typeof setupToolTest>['graph'],
  setId: string,
  value: unknown
): void {
  const set = getNodeOrThrow(graph, setId)
  graph.updateNode(setId, {
    pluginData: [
      ...(set.pluginData ?? []).filter(
        (item) => !(item.pluginId === RULES_PLUGIN_ID && item.key === DEFAULT_VARIANT_KEY)
      ),
      { pluginId: RULES_PLUGIN_ID, key: DEFAULT_VARIANT_KEY, value: JSON.stringify(value) }
    ]
  })
}

describe('default variant of a component set', () => {
  test('takes the marked variant', () => {
    const { graph, set, variants } = setupSet([
      'Content=Lead text checkbox, Type cell=Default',
      'Content=Text, Type cell=Default'
    ])
    markDefaultVariant(graph, set.id, variants[1].id)

    const resolved = resolveDefaultVariant(graph, set.id)
    expect(resolved?.variantName).toBe('Content=Text, Type cell=Default')
    expect(resolved?.source).toBe('marked')
  })

  test('falls back to the stored name when the stored id is stale', () => {
    const { graph, set } = setupSet([
      'Content=Lead text checkbox, Type cell=Default',
      'Content=Text, Type cell=Default'
    ])
    // Так выглядит пометка после пересборки: номер мёртв, имя верное.
    writeMark(graph, set.id, {
      variantId: '0:9999',
      variantName: 'Content=Text, Type cell=Default'
    })

    const resolved = resolveDefaultVariant(graph, set.id)
    expect(resolved?.variantName).toBe('Content=Text, Type cell=Default')
    expect(resolved?.source).toBe('marked')
  })

  test('guesses only when neither the id nor the name leads to a variant', () => {
    const { graph, set } = setupSet([
      'Content=Lead text checkbox, Type cell=Default',
      'Content=Text, Type cell=Default'
    ])
    writeMark(graph, set.id, { variantId: '0:9999', variantName: 'Content=Gone' })

    const resolved = resolveDefaultVariant(graph, set.id)
    expect(resolved?.variantName).toBe('Content=Lead text checkbox, Type cell=Default')
    expect(resolved?.source).toBe('guessed')
  })

  test('ignores a mark that points at a variant of another set', () => {
    const { graph, set, variants } = setupSet(['Content=Text, Type cell=Default'])
    const other = setupSet(['Content=Other'])
    writeMark(graph, set.id, { variantId: other.variants[0].id, variantName: '' })
    void variants

    const resolved = resolveDefaultVariant(graph, set.id)
    expect(resolved?.source).toBe('guessed')
    expect(resolved?.variantName).toBe('Content=Text, Type cell=Default')
  })
})
