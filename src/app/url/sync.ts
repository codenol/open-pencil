import { watch } from 'vue'
import type { RouteLocationNormalizedLoaded, Router } from 'vue-router'

import type { EditorStore } from '@/app/editor/session'
import { notificationMessages } from '@/app/i18n/notifications'
import {
  activeStorageProviderID,
  createActiveStorageAdapter
} from '@/app/integrations/storage'
import { getLocalCanvasStore } from '@/app/storage/local-store'
import { toast } from '@/app/shell/ui'
import {
  activeTab,
  createHomeTab,
  getActiveStore,
  getTabsSnapshot,
  listRecoverySnapshots,
  openStorageDocumentInNewTab,
  restoreRecoverySnapshot,
  switchTab,
  type Tab
} from '@/app/tabs'

const FILES_PATH = '/files'

/**
 * Ключ файла в адресе:
 *  - id документа в хранилище (сохранённые файлы);
 *  - id черновика (recovery-снапшот переживает перезагрузку — адрес остаётся постоянным).
 */
export function documentUrlKey(tab: Tab): string {
  const binding = tab.store.getStorageBinding()
  if (binding?.documentId) return binding.documentId
  try {
    return tab.store.getRecoveryId()
  } catch {
    return tab.id
  }
}

function fileUrl(tab: Tab): string {
  const key = encodeURIComponent(documentUrlKey(tab))
  const pageId = (tab.store.state as { currentPageId?: string }).currentPageId
  return pageId ? `/file/${key}/${encodeURIComponent(pageId)}` : `/file/${key}`
}

function findTabByKey(key: string): Tab | undefined {
  return getTabsSnapshot().find(
    (tab) => tab.kind === 'document' && documentUrlKey(tab) === key
  )
}

function showHomeTab(): void {
  const active = activeTab.value
  if (active?.kind === 'home') return
  const home = getTabsSnapshot().find((tab) => tab.kind === 'home')
  if (home) switchTab(home.id)
  else createHomeTab()
}

async function activatePage(store: EditorStore, pageId: string): Promise<void> {
  const page = store.graph.getNode(pageId)
  if (!page || page.type !== 'CANVAS') return
  if ((store.state as { currentPageId?: string }).currentPageId === pageId) return
  await store.switchPage(pageId)
}

/**
 * Двусторонняя синхронизация адреса и состояния воркспейса (схема как в Figma):
 *  - `/files` — список файлов;
 *  - `/file/<fileId>` — открытый файл;
 *  - `/file/<fileId>/<pageId>` — активная страница файла.
 */
export function useUrlSync(router: Router): void {
  let applying = false

  function currentUrl(): string {
    const tab = activeTab.value
    if (!tab || tab.kind === 'home') return FILES_PATH
    return fileUrl(tab)
  }

  function syncUrl(): void {
    const url = currentUrl()
    if (router.currentRoute.value.fullPath !== url) void router.replace(url)
  }

  watch(
    () => currentUrl(),
    () => {
      if (applying) return
      syncUrl()
    },
    { flush: 'post' }
  )

  async function applyRoute(route: RouteLocationNormalizedLoaded): Promise<void> {
    if (route.meta.demo || route.path.startsWith('/share/')) return
    const fileId = typeof route.params.fileId === 'string' ? route.params.fileId : ''
    if (!fileId) {
      if (route.path === FILES_PATH) showHomeTab()
      return
    }
    const pageId = typeof route.params.pageId === 'string' ? route.params.pageId : ''

    const existing = findTabByKey(fileId)
    if (existing) {
      if (activeTab.value?.id !== existing.id) switchTab(existing.id)
      if (pageId) await activatePage(existing.store, pageId)
      return
    }

    applying = true
    try {
      const meta = await getLocalCanvasStore().getMeta(fileId)
      if (meta) {
        await openStorageDocumentInNewTab({
          id: meta.id,
          name: meta.name,
          updatedAt: meta.updatedAt
        } as Parameters<typeof openStorageDocumentInNewTab>[0])
        syncUrl()
      } else {
        // Может быть черновиком: у них постоянный адрес, а содержимое — в recovery-снапшоте.
        const snapshots = await listRecoverySnapshots()
        if (snapshots.some((snapshot) => snapshot.id === fileId)) {
          await restoreRecoverySnapshot(fileId)
        } else {
          // Может быть файлом на сервере — например, ссылку открыли с другого устройства
          // или после очистки локальных данных.
          const adapter = createActiveStorageAdapter(activeStorageProviderID.value)
          const metadata = await adapter.getDocumentMetadata?.(fileId).catch(() => null)
          const stillMissing = !findTabByKey(fileId)
          if (metadata && stillMissing) {
            await openStorageDocumentInNewTab({
              id: fileId,
              name: metadata.name,
              updatedAt: metadata.updatedAt
            } as Parameters<typeof openStorageDocumentInNewTab>[0])
          } else if (!metadata) {
            toast.error(notificationMessages.get().openFileFailed({
              name: fileId,
              error: 'файл не найден ни в хранилище, ни среди черновиков'
            }))
            return
          }
        }
      }
      if (pageId) await activatePage(getActiveStore(), pageId)
    } catch (error) {
      console.warn('[URL sync] не удалось открыть файл', fileId, error)
    } finally {
      applying = false
      syncUrl()
    }
  }

  void router.isReady().then(() => {
    // Если пришли на корень — сразу приводим адрес к виду домашней («/files»).
    // Ссылки (?file=) не трогаем: их обрабатывает web-link и сам откроет документ.
    const hasWebLink = new URLSearchParams(window.location.search).has('file')
    if (!hasWebLink) {
      const tab = activeTab.value
      const url = !tab || tab.kind === 'home' ? FILES_PATH : fileUrl(tab)
      if (router.currentRoute.value.fullPath !== url) void router.replace(url)
    }
    void applyRoute(router.currentRoute.value)
  })
  router.afterEach((to) => {
    if (applying) return
    void applyRoute(to)
  })
}
