import { defineRule } from '#core/lint/rule'
const SCALE = new Set([0, 2, 4, 6, 8, 12, 16, 20, 24, 32, 9999])
export default defineRule({
  meta: {
    id: 'consistent-radius',
    category: 'layout',
    description: 'Corner radius should follow the radius scale'
  },
  match: ['RECTANGLE', 'FRAME', 'COMPONENT', 'INSTANCE'],
  check(node, context) {
    // Радиус, привязанный к переменной, уже следует шкале библиотеки.
    if (node.boundVariables.cornerRadius) return
    if (node.cornerRadius > 0 && !SCALE.has(node.cornerRadius))
      context.report({
        node,
        message: `Corner radius ${node.cornerRadius}px is not in scale`,
        suggest: 'Bind it to a radius token or use a scale value'
      })
  }
})
