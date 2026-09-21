// Провайдер хранилища «Сервер норки».
//
// Файлы живут на VPS рядом с редактором — открываются из списка и туда же
// сохраняются. Никакого S3: обычный HTTP к своему сервису
// (см. /opt/openpencil-norka/server.mjs).
//
// Настройки: адрес сервиса (по умолчанию /store — тот же домен, что и редактор).
import type {
  StorageAdapter,
  StorageDocument,
  StorageDocumentMetadata,
  StorageProviderRuntime
} from '@/app/integrations/storage/types'

const ENDPOINT_FIELD = 'endpoint'

function baseURL(runtime: StorageProviderRuntime): string {
  const raw = runtime.preferences[ENDPOINT_FIELD]?.trim() || '/store'
  return raw.replace(/\/+$/, '')
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(path, { cache: 'no-store', ...init })
  return res
}

export function createNorkaStorageAdapter(runtime: StorageProviderRuntime): StorageAdapter {
  const api = (path: string) => `${baseURL(runtime)}/api${path}`

  return {
    async testConnection() {
      try {
        const res = await request(api('/health'))
        if (!res.ok) {
          return { ok: false, message: `Сервер ответил ${res.status}` }
        }
        const data = (await res.json()) as { service?: string }
        return { ok: true, message: `Подключено: ${data.service ?? 'хранилище норки'}` }
      } catch (error) {
        return { ok: false, message: `Не удалось связаться с сервером: ${String(error)}` }
      }
    },

    async listDocuments(): Promise<StorageDocument[]> {
      const res = await request(api('/documents'))
      if (!res.ok) throw new Error(`Не удалось получить список файлов: ${res.status}`)
      const data = (await res.json()) as {
        documents: Array<{
          id: string
          name: string
          updatedAt: string | null
          hasThumbnail?: boolean
        }>
      }
      return data.documents.map((doc) => ({
        id: doc.id,
        name: doc.name,
        updatedAt: doc.updatedAt ?? new Date(0).toISOString(),
        thumbnailURL: doc.hasThumbnail ? api(`/documents/${encodeURIComponent(doc.id)}/thumbnail`) : null,
        metadataAuthoritative: true
      }))
    },

    async getDocument(id, onProgress, signal) {
      signal?.throwIfAborted()
      const res = await request(api(`/documents/${encodeURIComponent(id)}`), { signal })
      if (!res.ok) throw new Error(`Файл не найден: ${id}`)
      const total = Number(res.headers.get('content-length') ?? 0) || null
      const buffer = await res.arrayBuffer()
      onProgress?.({ transferredBytes: buffer.byteLength, totalBytes: total })
      return new Uint8Array(buffer)
    },

    async putDocument(id, bytes, metadata: StorageDocumentMetadata, onProgress) {
      const res = await request(api(`/documents/${encodeURIComponent(id)}`), {
        method: 'PUT',
        headers: {
          'content-type': 'application/octet-stream',
          'x-document-name': encodeURIComponent(metadata.name)
        },
        body: bytes
      })
      if (!res.ok) throw new Error(`Не удалось сохранить файл: ${res.status}`)
      onProgress?.({ transferredBytes: bytes.byteLength, totalBytes: bytes.byteLength })
    },

    async deleteDocument(id) {
      const res = await request(api(`/documents/${encodeURIComponent(id)}`), { method: 'DELETE' })
      if (!res.ok) throw new Error(`Не удалось удалить файл: ${res.status}`)
    },

    async getDocumentMetadata(id) {
      const res = await request(api(`/documents/${encodeURIComponent(id)}/metadata`))
      if (!res.ok) return null
      const data = (await res.json()) as { name: string; updatedAt: string }
      return { name: data.name, updatedAt: data.updatedAt }
    },

    async getUsage() {
      const documents = await this.listDocuments()
      return {
        bytesUsed: 0,
        objectCount: documents.length,
        documentCount: documents.length
      }
    },

    async getThumbnail(id) {
      const res = await request(api(`/documents/${encodeURIComponent(id)}/thumbnail`))
      if (!res.ok) return null
      return new Uint8Array(await res.arrayBuffer())
    },

    async putThumbnail(id, bytes) {
      await request(api(`/documents/${encodeURIComponent(id)}/thumbnail`), {
        method: 'PUT',
        headers: { 'content-type': 'image/png' },
        body: bytes
      })
    }
  }
}
