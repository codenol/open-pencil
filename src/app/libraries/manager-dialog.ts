import { ref } from 'vue'

/** Глобальное состояние диалога «Управление библиотеками» — открывается и с домашней
 * страницы (раздел «Библиотеки»), и из панели ассетов. */
export const libraryManagerDialogOpen = ref(false)
export const libraryManagerInitialSection = ref<'browse' | 'updates'>('browse')

export function openLibraryManagerDialog(section: 'browse' | 'updates' = 'browse'): void {
  libraryManagerInitialSection.value = section
  libraryManagerDialogOpen.value = true
}
