import { readSourceLibraryPublication } from '@open-pencil/core/library'

import { documentUrlKey } from '@/app/url/sync'
import { getTabsSnapshot } from '@/app/tabs'

import { rememberLibrarySource } from './sources'

/**
 * Подхватить связи «библиотека → файл» у открытых документов: в графе файла-источника
 * хранится метка публикации. Так библиотеку можно открыть для правок, даже если её
 * опубликовали раньше, чем появился этот механизм.
 */
export function refreshLibrarySources(): void {
  for (const tab of getTabsSnapshot()) {
    if (tab.kind !== 'document') continue
    try {
      const publication = readSourceLibraryPublication(tab.store.graph)
      if (publication) {
        rememberLibrarySource(publication.libraryId, documentUrlKey(tab), publication.name)
      }
    } catch {
      // граф без метки или недоступен — пропускаем
    }
  }
}
