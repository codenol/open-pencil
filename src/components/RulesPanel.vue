<script setup lang="ts">
import { computed, ref } from 'vue'

import { useI18n } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import { rulesOwner, useComponentRules } from '@/app/libraries/component-rules'
import ChatMarkdown from '@/components/chat/ChatMarkdown.vue'
import RulesEditorDialog from '@/components/rules/RulesEditorDialog.vue'
import { useRulesSectionTitles } from '@/components/rules/useRulesSectionTitles'
import AppButton from '@/components/ui/button/AppButton.vue'

/**
 * Вкладка «Правила» — правила выделенного компонента: как собирать, когда его
 * брать, когда нет, что можно менять и что трогать нельзя. Правила правятся
 * модалкой: текст markdown, рядом живой рендер.
 */
const { panels } = useI18n()
const store = useEditorStore()
const entry = useComponentRules()
const owner = computed(() => rulesOwner([...store.state.selectedIds][0]))

const editing = ref(false)

/** Порядок разделов правил; заголовки берутся из переводов. */
const sections = ['howto', 'use', 'avoid', 'allowed', 'forbidden', 'checks'] as const
const sectionTitles = useRulesSectionTitles()
</script>

<template>
  <div data-test-id="rules-panel" class="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-4">
    <template v-if="entry">
      <header class="mb-3">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <p class="text-[10px] tracking-wide text-muted uppercase">{{ panels.rules }}</p>
            <h3 class="truncate text-sm font-semibold text-surface">{{ entry.name }}</h3>
          </div>
          <AppButton
            v-if="owner"
            size="xs"
            variant="ghost"
            data-test-id="rules-edit"
            @click="editing = true"
          >
            {{ panels.rulesEdit }}
          </AppButton>
        </div>
        <div v-if="entry.rules.purpose" class="mt-1 text-xs leading-relaxed text-muted">
          <ChatMarkdown :content="entry.rules.purpose" />
        </div>
      </header>

      <section
        v-for="section in sections"
        v-show="entry.rules[section]?.length"
        :key="section"
        class="mb-4"
      >
        <h4 class="mb-1.5 text-[11px] font-semibold text-surface">
          {{ sectionTitles[section] }}
        </h4>
        <ol v-if="section === 'howto'" class="space-y-1.5">
          <li
            v-for="(item, index) in entry.rules[section]"
            :key="index"
            class="flex gap-2 text-xs leading-relaxed text-muted"
          >
            <span class="text-accent tabular-nums">{{ index + 1 }}.</span>
            <ChatMarkdown class="min-w-0 flex-1" :content="item" />
          </li>
        </ol>
        <ul v-else class="space-y-1.5">
          <li
            v-for="(item, index) in entry.rules[section]"
            :key="index"
            class="flex gap-2 text-xs leading-relaxed text-muted"
          >
            <span class="text-accent">·</span>
            <ChatMarkdown class="min-w-0 flex-1" :content="item" />
          </li>
        </ul>
      </section>
    </template>

    <template v-else>
      <section>
        <div class="flex items-start justify-between gap-2">
          <h3 class="text-[11px] font-semibold tracking-wide text-surface uppercase">
            {{ panels.rules }}
          </h3>
          <AppButton
            v-if="owner"
            size="xs"
            variant="ghost"
            data-test-id="rules-add"
            @click="editing = true"
          >
            {{ panels.rulesAdd }}
          </AppButton>
        </div>
        <p v-if="owner" class="mt-1 text-xs leading-relaxed text-surface">{{ owner.name }}</p>
        <p class="mt-1 text-xs leading-relaxed text-muted">{{ panels.rulesDescription }}</p>
      </section>

      <div
        data-test-id="rules-empty"
        class="mt-4 rounded-lg border border-dashed border-border px-4 py-8 text-center text-xs text-muted"
      >
        {{ panels.rulesEmpty }}
      </div>
    </template>

    <RulesEditorDialog v-model:open="editing" />
  </div>
</template>
