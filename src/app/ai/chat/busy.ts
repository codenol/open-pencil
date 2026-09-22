import { ref } from 'vue'

/**
 * Состояние работы ассистента, переживающее пересоздание панели.
 *
 * Чат живёт внутри своей панели, а заслонка нужна над рабочей областью —
 * это разные ветки разметки. Кроме того, панель периодически пересоздаётся:
 * при смене разговора, при сохранении истории. Всё, что хранится в самой
 * панели, в этот момент теряется — вместе со счётчиком времени, а он нужен
 * после окончания работы, чтобы видеть, сколько она заняла.
 */

const assistantBusy = ref(false)

/** Когда началась текущая работа. Ноль — работа не идёт. */
const startedAt = ref(0)

/** Сколько заняла последняя законченная работа. Остаётся до следующей. */
const lastRunMs = ref(0)

let timer: ReturnType<typeof setInterval> | undefined

export function setAssistantBusy(value: boolean): void {
  if (value === assistantBusy.value) return
  assistantBusy.value = value
  clearInterval(timer)
  timer = undefined

  if (value) {
    startedAt.value = Date.now()
    lastRunMs.value = 0
    timer = setInterval(() => {
      if (startedAt.value > 0) lastRunMs.value = Date.now() - startedAt.value
    }, 1000)
    return
  }

  // Замер по факту, а не по последнему тику: работа могла закончиться
  // между тиками, и тогда время занижалось.
  if (startedAt.value > 0) lastRunMs.value = Date.now() - startedAt.value
  startedAt.value = 0
}

/**
 * Время для показа: пока работа идёт — текущее, после — сколько заняла.
 * Одно и то же значение: счётчик останавливается на итоге и не сбрасывается.
 */
export function useAssistantTimer() {
  return {
    busy: assistantBusy,
    elapsedMs: lastRunMs
  }
}

export function useAssistantBusy() {
  return assistantBusy
}
