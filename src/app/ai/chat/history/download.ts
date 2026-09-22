import type { UIMessage } from 'ai'

import { chatLogFolder } from './upload'
import type { Conversation, ConversationMessage } from './types'

/**
 * Чтение логов разговора с сервера.
 *
 * Логи выгружались на сервер с самого начала — рядом с файлом, в папке с его
 * именем. Но обратно не читались: чат жил в браузере, и при перезагрузке
 * вкладки разговор пропадал вместе с ходом мысли ассистента.
 *
 * Здесь читаем то, что уже лежит на сервере. Это не замена локальному
 * хранилищу: локальное остаётся основным, серверное подхватывается, когда
 * разговор в браузере не нашёлся.
 */

const CHAT_ENDPOINT = '/store/api/chats'

/** Список разговоров, выгруженных на сервер. */
export interface RemoteConversation {
  id: string
  documentName: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

/** Список разговоров по документу. Тихо возвращаем пусто, если сервер молчит. */
export async function listRemoteConversations(documentId: string): Promise<RemoteConversation[]> {
  const folder = chatLogFolder(documentId)
  if (!folder) return []
  try {
    const response = await fetch(`${CHAT_ENDPOINT}/${encodeURIComponent(folder)}`)
    if (!response.ok) return []
    const body = (await response.json()) as { conversations?: RemoteConversation[] }
    return Array.isArray(body.conversations) ? body.conversations : []
  } catch {
    return []
  }
}

/** Разговор с сервера в виде, с которым работает чат. */
export async function fetchRemoteConversation(
  documentId: string,
  conversationId: string
): Promise<Conversation | null> {
  const folder = chatLogFolder(documentId)
  if (!folder) return null
  try {
    const response = await fetch(
      `${CHAT_ENDPOINT}/${encodeURIComponent(folder)}/${encodeURIComponent(conversationId)}`
    )
    if (!response.ok) return null
    const body = (await response.json()) as {
      conversation?: {
        id?: string
        documentName?: string
        title?: string
        createdAt?: string
        updatedAt?: string
        messages?: Array<{ message?: UIMessage }>
      }
    }
    const source = body.conversation
    if (!source?.id) return null

    const messages = (source.messages ?? [])
      .map((entry) => entry?.message)
      .filter((message): message is UIMessage => Boolean(message?.role))

    return {
      id: source.id,
      documentId,
      documentName: source.documentName ?? '',
      title: source.title ?? '',
      titleSource: 'generated',
      createdAt: source.createdAt ?? new Date().toISOString(),
      updatedAt: source.updatedAt ?? new Date().toISOString(),
      profileId: null,
      backend: 'direct',
      interrupted: false,
      messages: messages.map(
        (message): ConversationMessage => ({ message, attachments: [] })
      )
    }
  } catch {
    return null
  }
}
