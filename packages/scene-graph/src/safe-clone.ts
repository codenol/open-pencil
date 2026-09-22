/**
 * Копирование значения с переносимым результатом.
 *
 * `structuredClone` падает на символах и функциях, а в свойствах узла
 * встречаются служебные значения вроде `Symbol(mixed)`. Он же бросает
 * `DataCloneError`, который ломает всю операцию целиком — сохранение,
 * копирование, снимок истории.
 *
 * Копируем только то, что действительно копируется, остальное переносим
 * по ссылке: для снимков и откатов этого достаточно.
 */
export function safeClone<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  try {
    return structuredClone(value)
  } catch {
    return value
  }
}

/**
 * Копия узла без служебных значений.
 *
 * Поля с символами и функциями переносятся по ссылке: заменять их нельзя,
 * к ним привязаны и раскладка, и связь с компонентом.
 */
export function safeCloneNode<T extends object>(node: T): T {
  const result = {} as T
  for (const [key, value] of Object.entries(node)) {
    ;(result as Record<string, unknown>)[key] = safeClone(value)
  }
  return result
}
