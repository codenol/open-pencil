<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { useI18n } from '@open-pencil/vue'

import {
  customSystemPrompt,
  defaultSystemPrompt,
  isPromptCustomized,
  resetSystemPrompt,
  saveSystemPrompt
} from '@/app/ai/chat/prompt-settings'

/**
 * Характер ассистента: текст правил, по которым он работает в чате.
 * По умолчанию берётся из кода; здесь его можно переписать под себя.
 */
const { panels } = useI18n()

const draft = ref(customSystemPrompt.value || defaultSystemPrompt())
const saved = ref(false)
let savedTimer: ReturnType<typeof setTimeout> | undefined

const customized = computed(() => isPromptCustomized())
const changed = computed(() => draft.value.trim() !== (customSystemPrompt.value || defaultSystemPrompt()).trim())

watch(customSystemPrompt, () => {
  draft.value = customSystemPrompt.value || defaultSystemPrompt()
})

function save(): void {
  const text = draft.value.trim()
  // Пустой текст или текст, равный базовому, означает «вернуть базовый».
  saveSystemPrompt(text === defaultSystemPrompt().trim() ? '' : text)
  saved.value = true
  clearTimeout(savedTimer)
  savedTimer = setTimeout(() => (saved.value = false), 2500)
}

function reset(): void {
  resetSystemPrompt()
  draft.value = defaultSystemPrompt()
  saved.value = false
}
</script>

<template>
  <section data-test-id="prompt-settings" class="space-y-3">
    <header>
      <h3 class="text-sm font-semibold text-surface">{{ panels.assistantPrompt }}</h3>
      <p class="mt-1 text-xs leading-relaxed text-muted">{{ panels.assistantPromptHint }}</p>
    </header>

    <textarea
      v-model="draft"
      data-test-id="prompt-settings-text"
      rows="14"
      spellcheck="false"
      class="w-full resize-y rounded-lg border border-border bg-input px-3 py-2 font-mono text-[12px] leading-relaxed text-surface outline-none focus:border-accent"
    />

    <div class="flex items-center gap-2">
      <button
        type="button"
        data-test-id="prompt-settings-save"
        class="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
        :disabled="!changed"
        @click="save"
      >
        {{ panels.save }}
      </button>
      <button
        type="button"
        data-test-id="prompt-settings-reset"
        class="rounded-md border border-border px-3 py-1.5 text-xs text-surface disabled:opacity-40"
        :disabled="!customized && !changed"
        @click="reset"
      >
        {{ panels.resetToDefault }}
      </button>
      <span v-if="saved" class="text-xs text-success">{{ panels.saved }}</span>
      <span v-else-if="customized" class="text-xs text-muted">{{ panels.promptCustomized }}</span>
    </div>
  </section>
</template>
