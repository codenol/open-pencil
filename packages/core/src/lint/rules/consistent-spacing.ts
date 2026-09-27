import { defineRule } from '#core/lint/rule'
import { isMultipleOf, SPACING_FIELDS, SPACING_SCALE } from '#core/lint/utils'

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
    // Шкала документа (`space/…`) добавляется к зашитому списку: ступень,
    // которую завели в библиотеке, — такая же законная, как кратная восьми.
    const scale = context.numericScale('space')
    const valid = (value: number) =>
      SPACING_SCALE.includes(value) || isMultipleOf(value, base) || scale.has(value)
    for (const { field, label } of SPACING_FIELDS) {
      const value = node[field]
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
