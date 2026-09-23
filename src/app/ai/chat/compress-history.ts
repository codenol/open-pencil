import type { ModelMessage } from 'ai'

/**
 * Подрезка истории шагов перед отправкой модели.
 *
 * Ответы инструментов бывают крупными: разбор узла, справка по рендеру,
 * список компонентов. Ассистент делает до пятидесяти шагов, и каждый
 * следующий запрос отправляет всё, что было раньше. К середине задачи
 * контекст вырастает настолько, что браузер перестаёт справляться — работа
 * встаёт намертво, а остановить её не получается, потому что поток занят.
 *
 * Здесь свежие шаги остаются целиком, а старые сжимаются: вместо тела ответа
 * остаётся имя вызова и короткая выжимка. Ассистенту важно помнить, что он
 * уже сделал, а не точные байты старых ответов.
 */

/**
 * Сколько последних сообщений оставляем без изменений.
 *
 * Было двенадцать, и это оказалось много: свежие ответы инструментов самые
 * крупные (`get_components` отдаёт каталог на семнадцать килобайт), а запрос
 * уходит целиком на каждом шаге. При пятнадцати шагах набиралось девяносто
 * килобайт, и провайдер начинал отклонять запросы.
 *
 * Шесть — столько шагов нужно, чтобы держать нить работы: что сделал, что
 * проверяет, на чём остановился. Остальное помнить не обязательно.
 */
export const KEEP_FULL_MESSAGES = 6

/**
 * Сколько символов оставляем от старого ответа инструмента.
 *
 * Ответы инструментов — самая тяжёлая часть истории. Держать их целиком
 * незачем: важен итог шага, а не его байты.
 */
const SHRUNK_LIMIT = 400

/**
 * Предел для ответа инструмента в свежем хвосте.
 *
 * Больше, чем у старых шагов: свежий ответ ещё нужен для работы. Но и он не
 * может быть любого размера, иначе хвост перевешивает всю историю.
 */
const TAIL_LIMIT = 4000

function shrinkText(text: string): string {
  if (text.length <= SHRUNK_LIMIT) return text
  return `${text.slice(0, SHRUNK_LIMIT)}… [сокращено, шаг уже выполнен]`
}

/**
 * Сжимает начало истории, оставляя хвост нетронутым.
 *
 * `dropCount` — сколько самых старых сообщений подрезать. Системные
 * сообщения и запрос пользователя не трогаем: без них модель теряет задачу.
 */
export function compressStepHistory(
  messages: ModelMessage[],
  dropCount: number
): ModelMessage[] {
  if (dropCount <= 0 || messages.length <= KEEP_FULL_MESSAGES) return messages
  const boundary = Math.min(dropCount, messages.length - KEEP_FULL_MESSAGES)
  if (boundary <= 0) return messages

  const head: ModelMessage[] = []
  for (let index = 0; index < boundary; index++) {
    const message = messages[index]
    // Запрос пользователя — это сама задача, её не сокращаем.
    if (message.role === 'user' || message.role === 'system') {
      head.push(message)
      continue
    }
    if (typeof message.content === 'string') {
      head.push({ ...message, content: shrinkText(message.content) } as ModelMessage)
      continue
    }
    if (!Array.isArray(message.content)) {
      head.push(message)
      continue
    }
    const content = message.content.map((part) =>
      part.type === 'tool-result' && part.output?.type === 'text'
        ? { ...part, output: { ...part.output, value: shrinkText(part.output.value) } }
        : part
    )
    head.push({ ...message, content } as ModelMessage)
  }

  // Хвост тоже подрезаем — мягче и только очень крупные ответы.
  //
  // Иначе задача на полсотни шагов копится сотнями килобайт: свежие ответы
  // инструментов самые тяжёлые (осмотр узла — до семнадцати килобайт), и
  // несколько таких в хвосте весят больше, чем вся остальная история.
  // Провайдер отвечает отказом, и работа встаёт на ровном месте.
  const tail = messages.slice(boundary).map((message) => {
    if (typeof message.content === 'string') {
      if (message.content.length <= TAIL_LIMIT) return message
      return { ...message, content: `${message.content.slice(0, TAIL_LIMIT)}… [сокращено]` } as ModelMessage
    }
    if (!Array.isArray(message.content)) return message
    return {
      ...message,
      content: message.content.map((part) =>
        part.type === 'tool-result' &&
        part.output?.type === 'text' &&
        part.output.value.length > TAIL_LIMIT
          ? {
              ...part,
              output: { ...part.output, value: `${part.output.value.slice(0, TAIL_LIMIT)}… [сокращено]` }
            }
          : part
      )
    } as ModelMessage
  })

  return [...head, ...tail]
}
