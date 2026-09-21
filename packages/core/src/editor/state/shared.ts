import { DEFAULT_SNAPPING_PREFERENCES } from '#core/editor/preferences'
import type { EditorSharedState } from '#core/editor/types'

export function createDefaultEditorSharedState(): EditorSharedState {
  return {
    // По умолчанию — обычное редактирование. «Рука» стоит первой в панели,
    // но включать её по умолчанию нельзя: вместе с ней блокируется и правка,
    // и перетаскивание, и работа ассистента.
    activeTool: 'SELECT',
    snappingPreferences: { ...DEFAULT_SNAPPING_PREFERENCES },
    remoteCursors: [],
    documentName: 'Untitled',
    rulerTheme: undefined,
    sceneVersion: 0
  }
}
