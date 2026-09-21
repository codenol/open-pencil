import { ref } from 'vue'

/**
 * Занят ли ассистент прямо сейчас.
 *
 * Чат живёт внутри своей панели, а заслонка нужна над рабочей областью —
 * это разные ветки разметки. Общий признак здесь, чтобы панель чата его
 * выставляла, а заслонка читала.
 */
const assistantBusy = ref(false)

export function setAssistantBusy(value: boolean): void {
  assistantBusy.value = value
}

export function useAssistantBusy() {
  return assistantBusy
}
