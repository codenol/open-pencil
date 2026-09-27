import { defineRule } from '#core/lint/rule'

export default defineRule({
  meta: {
    id: 'no-hardcoded-radius',
    category: 'design-tokens',
    description: 'Corner radius should come from variables instead of hardcoded values'
  },
  match: ['RECTANGLE', 'FRAME', 'COMPONENT', 'INSTANCE'],
  check(node, context) {
    // Ноль — это отсутствие скругления, токен ему не нужен.
    if (node.cornerRadius <= 0) return
    if (node.boundVariables.cornerRadius) return
    context.report({
      node,
      message: `Corner radius ${node.cornerRadius}px is not bound to a token`,
      suggest: 'Bind it to a radius variable'
    })
  }
})
