import { computed } from 'vue'

/**
 * Номер и время сборки — подставляются плагином vite/build-label.ts.
 * Показываются в интерфейсе, чтобы всегда было видно, какая версия открыта:
 * после деплоя браузер может держать старую сборку в кэше.
 */
const label = typeof __BUILD_LABEL__ === 'string' ? __BUILD_LABEL__ : 'сборка без номера'
const number = typeof __BUILD_NUMBER__ === 'string' ? __BUILD_NUMBER__ : '0'

export function useBuildLabel() {
  return {
    buildLabel: computed(() => label),
    buildNumber: computed(() => number)
  }
}

export const buildLabel = label
export const buildNumber = number
