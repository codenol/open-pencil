import { defineRule } from '#core/lint/rule'
import { isMultipleOf, SPACING_SCALE } from '#core/lint/utils'

export default defineRule({
  meta: {
    id: 'consistent-spacing',
    category: 'layout',
    description: 'Spacing should follow the spacing scale'
  },
  match: ['FRAME', 'COMPONENT'],
  check(node, context) {
    if (node.layoutMode === 'NONE') return
    const config = context.getConfig() as { base?: number } | undefined
    const base = config?.base ?? 8
    const valid = (value: number) => SPACING_SCALE.includes(value) || isMultipleOf(value, base)
    const values: ReadonlyArray<[field: string, label: string, value: number]> = [
      ['itemSpacing', 'gap', node.itemSpacing],
      ['paddingTop', 'paddingTop', node.paddingTop],
      ['paddingRight', 'paddingRight', node.paddingRight],
      ['paddingBottom', 'paddingBottom', node.paddingBottom],
      ['paddingLeft', 'paddingLeft', node.paddingLeft]
    ]
    for (const [field, label, value] of values) {
      // Значение, привязанное к переменной, уже следует шкале библиотеки:
      // проверять его на 8pt-сетку нечем и незачем.
      if (node.boundVariables[field]) continue
      if (value > 0 && !valid(value)) {
        context.report({
          node,
          message: `${label} ${value}px is not in spacing scale`,
          suggest: 'Bind it to a spacing token or use an 8pt-grid multiple'
        })
      }
    }
  }
})
