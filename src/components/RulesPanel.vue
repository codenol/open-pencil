<script setup lang="ts">
import { useI18n } from '@open-pencil/vue'

/**
 * Вкладка «Правила» — место для правил компонента: когда его брать, когда нет,
 * что можно менять, чего нельзя. Пока пустая: показывает пояснение и место
 * под будущий список правил, чтобы структура панели была на месте.
 */
const { panels } = useI18n()
</script>

<template>
  <div
    data-test-id="rules-panel"
    class="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-4"
  >
    <section>
      <h3 class="mb-1 text-[11px] font-semibold tracking-wide text-surface uppercase">
        {{ panels.rules }}
      </h3>
      <p class="text-xs leading-relaxed text-muted">
        {{ panels.rulesDescription }}
      </p>
    </section>

    <div
      data-test-id="rules-empty"
      class="mt-4 rounded-lg border border-dashed border-border px-4 py-8 text-center text-xs text-muted"
    >
      {{ panels.rulesEmpty }}
    </div>
  </div>
</template>
