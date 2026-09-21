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

/** Сколько последних сообщений оставляем без изменений. */
export const KEEP_FULL_MESSAGES = 12

/** Сколько символов оставляем от старого ответа инструмента. */
const SHRUNK_LIMIT = 400

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

  return [...head, ...messages.slice(boundary)]
}
