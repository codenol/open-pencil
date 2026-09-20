import type { EditorStore } from '@/app/editor/session'
import { useLibraryService } from '@/app/libraries/service'

/**
 * Встроенные библиотеки поставлялись вместе с приложением (каталог /library-catalog/).
 * По требованию заказчика встроенные библиотеки удалены: список пуст, каталог не отдаётся.
 * Чтобы вернуть поставку — достаточно заполнить список и вернуть каталог на хостинг.
 */
export const PRESET_LIBRARY_IDS: readonly string[] = []

const LIBRARY_PREFS_KEY = 'open-pencil:library-preferences'
const STORAGE_PREFS_KEY = 'open-pencil:storage:preferences'
const PRESET_CACHE_KEY = 'open-pencil:preset-cache-format'
const PRESET_CACHE_VERSION = 'cleared-v1'

/**
 * Сброс ранее загруженных встроенных библиотек (skala-*) из кэша браузера:
 * после удаления поставки они не должны оставаться в списках.
 */
export async function invalidateOutdatedPresetCache(): Promise<void> {
  try {
    if (localStorage.getItem(PRESET_CACHE_KEY) === PRESET_CACHE_VERSION) return
    await new Promise<void>((resolve) => {
      const request = indexedDB.open('open-pencil-libraries')
      request.onerror = () => resolve()
      request.onsuccess = () => {
        const db = request.result
        try {
          const tx = db.transaction(['latest', 'revisions'], 'readwrite')
          const latest = tx.objectStore('latest')
          const revisions = tx.objectStore('revisions')
          const cursor = latest.openCursor()
          cursor.onsuccess = () => {
            const entry = cursor.result
            if (entry) {
              const value = entry.value as { libraryId?: string }
              if (value?.libraryId?.startsWith('skala-')) entry.delete()
              entry.continue()
            }
          }
          const revCursor = revisions.openCursor()
          revCursor.onsuccess = () => {
            const entry = revCursor.result
            if (entry) {
              const value = entry.value as { libraryId?: string }
              if (value?.libraryId?.startsWith('skala-')) entry.delete()
              entry.continue()
            }
          }
          tx.oncomplete = () => resolve()
          tx.onerror = () => resolve()
          tx.onabort = () => resolve()
        } catch {
          resolve()
        }
      }
    })
    localStorage.setItem(PRESET_CACHE_KEY, PRESET_CACHE_VERSION)
  } catch {
    // кэш — необязательная часть, ошибки игнорируем
  }
}

/**
 * Миграция старых профилей: если источник каталога был переключён на «Хранилище»,
 * но S3-настройки отсутствуют (например, прежняя сборка с предустановленным каталогом),
 * возвращаем источник в «Локальные».
 */
export function sanitizeLibraryCatalogSource(): void {
  try {
    const raw = localStorage.getItem(LIBRARY_PREFS_KEY)
    if (!raw) return
    const preferences = JSON.parse(raw) as { catalogSource?: string }
    if (preferences?.catalogSource !== 'storage') return
    const storageRaw = localStorage.getItem(STORAGE_PREFS_KEY)
    const storage = storageRaw ? (JSON.parse(storageRaw) as Record<string, Record<string, string>>) : {}
    const s3 = storage?.['s3-compatible'] ?? {}
    const configured = Boolean(s3.endpoint?.trim() && s3.bucket?.trim())
    if (configured) return
    localStorage.setItem(
      LIBRARY_PREFS_KEY,
      JSON.stringify({ ...preferences, catalogSource: 'local' })
    )
  } catch {
    // игнорируем повреждённые настройки
  }
}

/**
 * Включает предустановленные библиотеки в открытом документе, чтобы компоненты дизайн-системы
 * были доступны и в панели Assets, и AI-инструментам (get_components / insert_library_component).
 * Ревизии подтягиваются последовательно в фоне: первый заход скачивает и кэширует,
 * дальше подключение мгновенное.
 */
export async function ensurePresetLibrariesEnabled(editor: EditorStore): Promise<void> {
  try {
    await invalidateOutdatedPresetCache()
    const service = useLibraryService()
    for (const libraryId of PRESET_LIBRARY_IDS) {
      if (editor.graph.enabledLibraries.get(libraryId)?.enabled) continue
      try {
        await service.enable(editor, libraryId)
        editor.requestRender()
      } catch (error) {
        console.warn(`[Preset libraries] Библиотека ${libraryId} недоступна`, error)
      }
    }
  } catch (error) {
    console.warn('[Preset libraries] Автоподключение не удалось', error)
  }
}
