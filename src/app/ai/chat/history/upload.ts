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
export async function uploadConversation(conversation: Conversation): Promise<boolean> {
  try {
    const response = await fetch(endpoint(conversation.documentId, conversation.id), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(conversation)
    })
    return response.ok
  } catch {
    return false
  }
}

/** Список сохранённых логов по файлу. */
export async function listConversations(documentId: string): Promise<ChatLogSummary[]> {
  try {
    const response = await fetch(endpoint(documentId))
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
