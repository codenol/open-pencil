import { createNorkaStorageAdapter } from './norka/adapter'
import { defineStorageProvider, StorageProviderRegistry } from './registry'
import { createS3StorageAdapter } from './s3/adapter'

/**
 * Хранилище норки: файлы лежат на том же сервере, где развёрнут редактор.
 * Основной способ работы — открыть из списка и сохранять туда же. Обмен
 * с локальным компьютером («загрузить с ПК» / «скачать») остаётся отдельно.
 */
export const NORKA_STORAGE_PROVIDER = defineStorageProvider({
  id: 'norka-server',
  label: 'Сервер норки',
  description: 'Файлы на сервере рядом с редактором — открываются из списка и сохраняются туда же',
  preferenceFields: [
    {
      id: 'endpoint',
      label: 'Адрес сервиса',
      kind: 'text',
      placeholder: '/store'
    }
  ],
  credentialFields: [],
  createAdapter: createNorkaStorageAdapter
})

export const S3_STORAGE_PROVIDER = defineStorageProvider({
  id: 's3-compatible',
  label: 'S3 storage',
  description: 'AWS S3, Backblaze B2, Cloudflare R2, MinIO, and compatible storage',
  preferenceFields: [
    { id: 'endpoint', label: 'Endpoint', kind: 'url', required: true },
    { id: 'bucket', label: 'Bucket', kind: 'text', required: true },
    { id: 'region', label: 'Region', kind: 'text' }
  ],
  credentialFields: [
    { id: 'access-key-id', label: 'Access key ID', required: true },
    { id: 'secret-access-key', label: 'Secret access key', required: true }
  ],
  createAdapter: createS3StorageAdapter
})

export const storageProviderRegistry = new StorageProviderRegistry([
  NORKA_STORAGE_PROVIDER,
  S3_STORAGE_PROVIDER
])
