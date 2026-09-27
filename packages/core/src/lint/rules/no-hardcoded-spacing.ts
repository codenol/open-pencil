import { defineRule } from '#core/lint/rule'
import { isInsideInstance, SPACING_FIELDS } from '#core/lint/utils'

export default defineRule({
  meta: {
    id: 'no-hardcoded-spacing',
    category: 'design-tokens',
    description: 'Spacing and gaps should come from variables instead of hardcoded values'
  },
  match: ['FRAME', 'COMPONENT'],
  check(node, context) {
    if (node.layoutMode === 'NONE') return
    // Копия наследует привязки мастера — долг считается по мастеру.
    if (isInsideInstance(node)) return
    for (const { field, label } of SPACING_FIELDS) {
      const value = node[field]
      // Ноль — это отсутствие отступа, токен ему не нужен.
      if (value <= 0) continue
      if (node.boundVariables[field]) continue
      context.report({
        node,
        message: `${label} ${value}px is not bound to a token`,
        suggest: 'Bind it to a spacing variable'
      })
    }
  }
})
