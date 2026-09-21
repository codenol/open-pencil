/**
 * Выгрузка логов чата на сервер.
 *
 * История чата лежит в браузере и привязана к файлу (`documentId`), но живёт
 * только в IndexedDB: пропадает при чистке браузера и не видна снаружи.
 * Здесь тот же разговор уезжает на сервер рядом с файлом — чтобы можно было
 * посмотреть, как ассистент рассуждал: что смог, чего нет.
 *
 * Хранение: /var/lib/openpencil-norka/chats/<documentId>/<conversationId>.json
 */
import type { Conversation } from '@/app/ai/chat/history/types'

const CHAT_ENDPOINT = '/store/api/chats'

export interface ChatLogSummary {
  id: string
  documentId: string
  documentName: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

function endpoint(documentId: string, conversationId?: string): string {
  const base = `${CHAT_ENDPOINT}/${encodeURIComponent(documentId)}`
  return conversationId ? `${base}/${encodeURIComponent(conversationId)}` : base
}

/**
 * Отправляет разговор на сервер. Ошибки глушим: выгрузка логов не должна
 * ломать саму работу с чатом — она вспомогательная.
 */
/**
 * Имя файла для хранения логов.
 *
 * Внутренний идентификатор несёт служебные части (`storage:["norka","ds-main"]`),
 * а рядом с файлом удобнее видеть просто его имя. Приводим к читаемому виду,
 * чтобы логи лежали в папке `ds-main`, а не в длинной строке с экранированием.
 */
export function chatLogFolder(documentId: string): string {
  const text = documentId.trim()
  // storage:["provider","id"] или storage:["id"]
  const storage = /^storage:\s*\[(.*)\]$/.exec(text)
  if (storage) {
    try {
      const parts = JSON.parse(`[${storage[1]}]`) as unknown[]
      const id = parts.length > 1 ? parts[parts.length - 1] : parts[0]
      if (typeof id === 'string' && id) return sanitize(id)
    } catch {
      // не разобрали — падаем на общую очистку ниже
    }
  }
  const file = /^file:(.*)$/.exec(text)
  if (file) {
    const name = file[1].split('/').filter(Boolean).pop() ?? file[1]
    return sanitize(name)
  }
  return sanitize(text.replace(/^recovery:/, ''))
}

/** Оставляем только безопасные для имени папки символы. */
function sanitize(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return cleaned || 'untitled'
}

export async function uploadConversation(conversation: Conversation): Promise<boolean> {
  try {
    const response = await fetch(
      endpoint(chatLogFolder(conversation.documentId), conversation.id),
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(conversation)
      }
    )
    return response.ok
  } catch {
    return false
  }
}

/** Список сохранённых логов по файлу. */
export async function listConversations(documentId: string): Promise<ChatLogSummary[]> {
  try {
    const response = await fetch(endpoint(chatLogFolder(documentId)))
    if (!response.ok) return []
    const data = (await response.json()) as { conversations?: ChatLogSummary[] }
    return data.conversations ?? []
  } catch {
    return []
  }
}

/** Читает один сохранённый лог целиком. */
export async function readConversation(
  documentId: string,
  conversationId: string
): Promise<Conversation | null> {
  try {
    const response = await fetch(endpoint(documentId, conversationId))
    if (!response.ok) return null
    return (await response.json()) as Conversation
  } catch {
    return null
  }
}
