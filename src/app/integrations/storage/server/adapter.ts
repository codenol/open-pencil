import type {
  LibraryObjectStore,
  StorageAdapter,
  StorageConnectionResult,
  StorageDocument,
  StorageDocumentMetadata,
  StorageProviderRuntime,
  StorageUsage
} from '@/app/integrations/storage'

const BASE = '/api'

async function request(
  path: string,
  init?: RequestInit,
  onProgress?: (transferred: number, total: number | null) => void
): Promise<Response> {
  const response = await fetch(`${BASE}${path}`, init)
  if (!response.ok && response.status !== 404) {
    const text = await response.text().catch(() => '')
    throw new Error(`Сервер: ${response.status} ${text.slice(0, 200)}`)
  }
  onProgress?.(0, null)
  return response
}

/**
 * Собственное серверное хранилище (VPS): файлы и объекты каталога библиотек
 * живут на нашем сервере по адресу /api — общие для всей команды.
 */
export function createServerStorageAdapter(_runtime: StorageProviderRuntime): StorageAdapter {
  const libraryObjects: LibraryObjectStore = {
    async getObject(key) {
      const response = await fetch(`${BASE}/objects?key=${encodeURIComponent(key)}`)
      if (response.status === 404) return null
      if (!response.ok) throw new Error(`Сервер: ${response.status}`)
      return new Uint8Array(await response.arrayBuffer())
    },

    async getObjectValue(key) {
      const response = await fetch(`${BASE}/objects?key=${encodeURIComponent(key)}`)
      if (response.status === 404) return { bytes: null, etag: null }
      if (!response.ok) throw new Error(`Сервер: ${response.status}`)
      return { bytes: new Uint8Array(await response.arrayBuffer()), etag: response.headers.get('etag') }
    },

    async putObject(key, bytes) {
      const response = await fetch(`${BASE}/objects?key=${encodeURIComponent(key)}`, {
        method: 'PUT',
        body: bytes
      })
      if (!response.ok) throw new Error(`Сервер: ${response.status}`)
    },

    async listObjects(prefix) {
      const response = await fetch(`${BASE}/objects?prefix=${encodeURIComponent(prefix)}`)
      if (!response.ok) throw new Error(`Сервер: ${response.status}`)
      const payload = (await response.json()) as {
        objects: { key: string; size: number | null; etag: string | null }[]
      }
      return payload.objects
    }
  }

  return {
    async testConnection(): Promise<StorageConnectionResult> {
      try {
        const response = await fetch(`${BASE}/health`)
        if (!response.ok) return { ok: false, message: `Сервер ответил ${response.status}` }
        return { ok: true, message: 'Серверное хранилище доступно' }
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) }
      }
    },

    async listDocuments(): Promise<StorageDocument[]> {
      const response = await request('/files')
      const payload = (await response.json()) as {
        files: { id: string; name: string; updatedAt: string }[]
      }
      return payload.files.map((file) => ({
        id: file.id,
        name: file.name,
        updatedAt: file.updatedAt,
        metadataAuthoritative: true
      }))
    },

    async getDocument(id, onProgress, signal) {
      const response = await fetch(`${BASE}/files/${encodeURIComponent(id)}`, { signal })
      if (!response.ok) throw new Error(`Сервер: ${response.status}`)
      onProgress?.({ transferredBytes: 0, totalBytes: null })
      const bytes = new Uint8Array(await response.arrayBuffer())
      onProgress?.({ transferredBytes: bytes.length, totalBytes: bytes.length })
      return bytes
    },

    async putDocument(id, bytes, metadata: StorageDocumentMetadata) {
      const response = await fetch(`${BASE}/files/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: {
          'x-document-name': encodeURIComponent(metadata.name),
          'x-document-updated': metadata.updatedAt
        },
        body: bytes
      })
      if (!response.ok) throw new Error(`Сервер: ${response.status}`)
    },

    async getDocumentMetadata(id) {
      const response = await fetch(`${BASE}/files/${encodeURIComponent(id)}/metadata`)
      if (!response.ok) return null
      const payload = (await response.json()) as { name: string; updatedAt: string }
      return { name: payload.name, updatedAt: payload.updatedAt }
    },

    async deleteDocument(id) {
      await request(`/files/${encodeURIComponent(id)}`, { method: 'DELETE' })
    },

    async renameDocument(id, name) {
      const response = await fetch(`${BASE}/files/${encodeURIComponent(id)}/metadata`, {
        method: 'PATCH',
        headers: { 'x-document-name': encodeURIComponent(name) },
        body: new Uint8Array()
      })
      if (!response.ok) throw new Error(`Сервер: ${response.status}`)
    },

    async getUsage(): Promise<StorageUsage> {
      const response = await request('/usage')
      return (await response.json()) as StorageUsage
    },

    async getThumbnail(id) {
      const response = await fetch(`${BASE}/files/${encodeURIComponent(id)}/thumbnail`)
      if (!response.ok) return null
      return new Uint8Array(await response.arrayBuffer())
    },

    async putThumbnail(id, bytes) {
      await fetch(`${BASE}/files/${encodeURIComponent(id)}/thumbnail`, { method: 'PUT', body: bytes })
    },

    libraryObjects
  }
}
