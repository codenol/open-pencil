import { useLocalStorage } from '@vueuse/core'

/**
 * Библиотека, которая подключается к каждому новому файлу автоматически.
 * Дизайнер выбирает её в списке библиотек («Подключать в новых файлах»).
 */
export const defaultLibraryId = useLocalStorage<string | null>(
  'open-pencil:default-library',
  null
)
