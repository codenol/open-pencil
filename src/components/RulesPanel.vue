<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '@open-pencil/vue'

import { useComponentRules } from '@/app/libraries/component-rules'

/**
 * Вкладка «Правила» — правила выделенного компонента: когда его брать, когда
 * нет, что можно менять и что трогать нельзя. Если правил нет — поясняем,
 * для чего вкладка, чтобы структура была понятна.
 */
const { panels } = useI18n()
const entry = useComponentRules()

/** Порядок разделов правил; заголовки берутся из переводов. */
const sections = ['use', 'avoid', 'allowed', 'forbidden', 'checks'] as const

/** Инструкция идёт первой: с неё начинают, остальное читают по ходу. */
const howto = computed(() => entry.value?.rules.howto ?? [])

/** Заголовок раздела правил на текущем языке. */
function sectionTitle(section: string): string {
  const titles = panels.value.rulesSections as unknown as Record<string, string>
  return titles[section] ?? section
}
</script>

<template>
  <div
    data-test-id="rules-panel"
    class="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-4"
  >
    <template v-if="entry">
      <header class="mb-3">
        <p class="text-[10px] tracking-wide text-muted uppercase">{{ panels.rules }}</p>
        <h3 class="text-sm font-semibold text-surface">{{ entry.name }}</h3>
        <p v-if="entry.rules.purpose" class="mt-1 text-xs leading-relaxed text-muted">
          {{ entry.rules.purpose }}
        </p>
      </header>

      <section v-if="howto.length > 0" class="mb-4" data-test-id="rules-howto">
        <h4 class="mb-1.5 text-[11px] font-semibold text-surface">
          {{ sectionTitle('howto') }}
        </h4>
        <ol class="space-y-1.5">
          <li
            v-for="(step, index) in howto"
            :key="index"
            class="flex gap-2 text-xs leading-relaxed text-muted"
          >
            <span class="text-accent tabular-nums">{{ index + 1 }}.</span>
            <span>{{ step }}</span>
          </li>
        </ol>
      </section>

      <section
        v-for="section in sections"
        v-show="entry.rules[section]?.length"
        :key="section"
        class="mb-4"
      >
        <h4 class="mb-1.5 text-[11px] font-semibold text-surface">
          {{ sectionTitle(section) }}
        </h4>
        <ul class="space-y-1.5">
          <li
            v-for="(item, index) in entry.rules[section]"
            :key="index"
            class="flex gap-2 text-xs leading-relaxed text-muted"
          >
            <span class="text-accent">·</span>
            <span>{{ item }}</span>
          </li>
        </ul>
      </section>
    </template>

    <template v-else>
      <section>
        <h3 class="mb-1 text-[11px] font-semibold tracking-wide text-surface uppercase">
          {{ panels.rules }}
        </h3>
        <p class="text-xs leading-relaxed text-muted">{{ panels.rulesDescription }}</p>
      </section>

      <div
        data-test-id="rules-empty"
        class="mt-4 rounded-lg border border-dashed border-border px-4 py-8 text-center text-xs text-muted"
      >
        {{ panels.rulesEmpty }}
      </div>
    </template>
  </div>
</template>
