<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '@open-pencil/vue'

import { useAssistantBusy } from '@/app/ai/chat/busy'

/**
 * Заслонка на рабочую область, пока ассистент занят.
 *
 * Пока ассистент думает или меняет документ, любые действия руками мешают:
 * он работает с тем же документом, и правки в этот момент расходятся с его
 * картиной мира. Заслонка гасит ввод в рабочей области, но чат остаётся
 * живым — видно ход работы и можно остановить.
 */
const { ai } = useI18n()
const busy = useAssistantBusy()
const running = computed(() => busy.value)
</script>

<template>
  <div
    v-if="running"
    data-test-id="assistant-busy-overlay"
    class="absolute inset-0 z-30 flex cursor-progress items-start justify-center bg-surface/5 backdrop-blur-[1px]"
    :aria-label="ai.assistantWorking"
    role="presentation"
  >
    <div
      class="pointer-events-none mt-16 flex items-center gap-2 rounded-full border border-border bg-panel/95 px-3 py-1.5 shadow-sm"
    >
      <icon-lucide-loader-circle class="size-3.5 animate-spin text-accent" />
      <span class="text-xs text-surface">{{ ai.assistantWorking }}</span>
    </div>
  </div>
</template>
