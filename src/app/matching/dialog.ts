import { ref } from 'vue'

/** Глобальное состояние диалога «Соответствие» — список копий файла и привязка к мастерам. */
export const matchDialogOpen = ref(false)

export function openMatchDialog(): void {
  matchDialogOpen.value = true
}
