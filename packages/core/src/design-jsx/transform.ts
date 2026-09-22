import { transform } from 'sucrase'

const options = {
  transforms: ['typescript', 'jsx'] as Array<'typescript' | 'jsx'>,
  jsxPragma: '__h',
  jsxFragmentPragma: '__fragment',
  production: true
}

function transformExpression(source: string): string {
  return transform(`return (${source.trim()})`, options).code
}

function statementBoundaries(source: string): number[] {
  const boundaries = new Set<number>()
  for (let index = 0; index < source.length; index++) {
    if (source[index] === '\n') boundaries.add(index + 1)
  }
  return [...boundaries].sort((left, right) => right - left)
}

/**
 * Transform Design JSX into a function body. A plain JSX expression is accepted directly.
 * For authored programs, top-level declarations must precede a final expression on a new line.
 */
export function transformDesignJSXExpression(source: string): string {
  const trimmed = source.trim()
  try {
    return transformExpression(trimmed)
  } catch (expressionError) {
    for (const boundary of statementBoundaries(trimmed)) {
      const statements = trimmed.slice(0, boundary).trim()
      const expression = trimmed.slice(boundary).trim()
      if (!statements || !expression) continue
      try {
        const transformedStatements = transform(statements, options).code
        return `${transformedStatements}\n${transformExpression(expression)}`
      } catch {
        continue
      }
    }
    throw withHint(expressionError, trimmed)
  }
}

/**
 * Поясняет ошибку разбора.
 *
 * Сообщения парсера вроде «Unexpected token (44:13)» называют позицию внутри
 * обёрнутого выражения, а не строку авторского кода, и потому уводят в сторону:
 * ассистент решил, что render обрывает большой JSX, и стал собирать мелкими
 * порциями. На деле чаще всего не закрыт тег — тогда позиция указывает на
 * строку после пропущенного закрытия.
 */
function withHint(error: unknown, source: string): Error {
  const message = error instanceof Error ? error.message : String(error)
  const hint = describeLikelyCause(source)
  const wrapped = new Error(hint ? `${message}. ${hint}` : message)
  if (error instanceof Error) wrapped.stack = error.stack
  return wrapped
}

/**
 * Догадка о причине: следим за глубиной вложенности по коду.
 *
 * Общий счёт открытых и закрытых тегов не помогает: их число может сойтись,
 * а вложенность быть неверной — закрывающий тег встаёт не на своё место, и
 * следующие элементы оказываются siblings вместо children.
 */
function describeLikelyCause(source: string): string {
  const tags = source.match(/<\/?[A-Z][A-Za-z0-9]*[^>]*?>/g) ?? []
  let depth = 0
  let minDepth = 0
  for (const tag of tags) {
    if (/\/>$/.test(tag)) continue
    if (tag.startsWith('</')) depth -= 1
    else depth += 1
    minDepth = Math.min(minDepth, depth)
    if (minDepth < 0) {
      return 'A closing tag does not match the opening order: an outer element was closed too early, and later content sits outside it. Check the nesting, do not shrink the code.'
    }
  }
  if (depth !== 0) {
    return `The nesting does not close: ${depth > 0 ? `${depth} element(s) left open` : 'too many closing tags'}. Check the nesting, do not shrink the code.`
  }
  return 'The nesting is uneven even though tags balance: an element closes before its siblings are written. Check the order, do not shrink the code.'
}
