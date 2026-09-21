import { useLocalStorage } from '@vueuse/core'

import DEFAULT_SYSTEM_PROMPT from '@/app/ai/chat/system-prompt.md?raw'

/**
 * Характер ассистента — то, как он себя ведёт в чате.
 *
 * По умолчанию берётся из файла в коде. Пользователь может править текст в
 * настройках модели: правка хранится отдельно и используется вместо базовой.
 * Сброс возвращает исходный текст.
 */
const DEFAULT_PROMPT = DEFAULT_SYSTEM_PROMPT.trim()

export const customSystemPrompt = useLocalStorage<string>('open-pencil:ai:system-prompt', '')

/** Текст, с которым сейчас работает ассистент: правка пользователя либо базовый. */
export function activeSystemPrompt(): string {
  const custom = customSystemPrompt.value.trim()
  return custom || DEFAULT_PROMPT
}

export function isPromptCustomized(): boolean {
  return customSystemPrompt.value.trim().length > 0
}

/** Сохраняет правку. Пустая строка означает «вернуть базовый текст». */
export function saveSystemPrompt(text: string): void {
  customSystemPrompt.value = text
}

export function resetSystemPrompt(): void {
  customSystemPrompt.value = ''
}

export function defaultSystemPrompt(): string {
  return DEFAULT_PROMPT
}
