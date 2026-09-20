import { useLibraryService } from '@/app/libraries'
import { createTab, findTabByLibraryId, switchTab } from '@/app/tabs'
import { createEditorStore } from '@/app/editor/session'

/**
 * Открывает библиотеку на просмотр — как файл, в новой вкладке.
 *
 * На стартовом экране (список файлов) библиотеку не к чему подключать:
 * подключение имеет смысл только внутри рабочего документа. Поэтому клик
 * по библиотеке в списке открывает её содержимое, а не диалог управления.
 */
export async function openLibraryAsFile(libraryId: string): Promise<void> {
  const existing = findTabByLibraryId(libraryId)
  if (existing) {
    switchTab(existing.id)
    return
  }

  const service = useLibraryService()
  const summary = service.summaries.value.find((item) => item.libraryId === libraryId)
  const revision = await service.getRevision(libraryId, summary?.latestRevisionId)

  // Страницы библиотеки хранятся служебными — редактор такие прячет и падает
  // без публичной страницы. Для просмотра делаем их обычными.
  for (const page of revision.graph.getPages(true)) page.internalOnly = false

  const store = createEditorStore(revision.graph)
  store.state.documentName = revision.manifest.name

  createTab(store, undefined, { kind: 'library', libraryId })
}
