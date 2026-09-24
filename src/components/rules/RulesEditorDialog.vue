<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { useI18n } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import {
  RULES_SECTIONS,
  readRules,
  rulesOwner,
  writeRules,
  type ComponentRules,
  type RulesSection
} from '@/app/libraries/component-rules'
import ChatMarkdown from '@/components/chat/ChatMarkdown.vue'
import AppButton from '@/components/ui/button/AppButton.vue'
import { AppDialog } from '@/components/ui/dialog'
import AppTextarea from '@/components/ui/input/AppTextarea.vue'
import { rulesLabel, useRulesSectionTitles } from '@/components/rules/useRulesSectionTitles'

/**
 * Редактор правил компонента.
 *
 * Правила — те же разделы, что видит ассистент, поэтому и правятся они
 * поблочно: нажал блок — он открылся, слева markdown, справа сразу рендер.
 * Пишем в pluginData компонента, поэтому правила переживают сохранение и
 * перезагрузку, а отмена возвращает прежний текст.
 */
const open = defineModel<boolean>('open', { default: false })

const store = useEditorStore()
const { panels, common } = useI18n()

const owner = computed(() => rulesOwner([...store.state.selectedIds][0]))

/** В черновике раздел — это текст: у списков одна строка = один пункт. */
type Draft = Record<RulesSection, string>

const EMPTY_DRAFT: Draft = {
  purpose: '',
  howto: '',
  use: '',
  avoid: '',
  allowed: '',
  forbidden: '',
  checks: ''
}

const draft = ref<Draft>({ ...EMPTY_DRAFT })
const opened = ref<RulesSection | null>(null)

const sections = computed<RulesSection[]>(() => ['purpose', ...RULES_SECTIONS])
const sectionTitles = useRulesSectionTitles()

/** Черновик собирается из правил заново при каждом открытии окна. */
watch(open, (value) => {
  opened.value = null
  if (!value) return
  const rules = owner.value ? readRules(owner.value.id) : null
  const next: Draft = { ...EMPTY_DRAFT }
  next.purpose = rules?.purpose ?? ''
  for (const key of RULES_SECTIONS) next[key] = (rules?.[key] ?? []).join('\n')
  draft.value = next
})

/** Первая строка раздела — чтобы список блоков читался без открытия. */
function summary(section: RulesSection): string {
  const first = draft.value[section]
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)
  return first ?? rulesLabel(panels.value.rulesBlockEmpty)
}

/** Что показываем справа: описание как есть, списки — пунктами. */
const preview = computed(() => {
  const section = opened.value
  if (!section) return ''
  const lines = draft.value[section].split('\n').map((line) => line.trim()).filter(Boolean)
  if (section === 'purpose') return lines.join('\n\n')
  return lines.map((line) => `- ${line}`).join('\n')
})

const hint = computed(() =>
  opened.value === 'purpose' ? panels.value.rulesTextHint : panels.value.rulesStepsHint
)

function toRules(): ComponentRules {
  const rules: ComponentRules = {}
  if (draft.value.purpose.trim() !== '') rules.purpose = draft.value.purpose.trim()
  for (const key of RULES_SECTIONS) {
    const items = draft.value[key]
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
    if (items.length > 0) rules[key] = items
  }
  return rules
}

function save(): void {
  const target = owner.value
  if (!target) return
  writeRules(store, target.id, toRules())
  open.value = false
}
</script>

<template>
  <AppDialog
    v-model:open="open"
    data-test-id="rules-editor"
    size="xl"
    height="tall"
    :heading="rulesLabel(panels.rules)"
    :description="owner?.name"
    :ui="{ body: 'flex min-h-0 flex-col' }"
  >
    <!-- Список блоков: нажал — блок открылся. -->
    <div v-if="opened === null" class="flex flex-col gap-1">
      <button
        v-for="section in sections"
        :key="section"
        type="button"
        :data-test-id="`rules-block-${section}`"
        class="flex cursor-pointer flex-col items-start gap-0.5 rounded border border-transparent px-2 py-1.5 text-left transition-colors hover:border-border hover:bg-panel-field"
        @click="opened = section"
      >
        <span class="text-[11px] font-semibold text-surface">{{ sectionTitles[section] }}</span>
        <span class="w-full truncate text-[11px] text-muted">{{ summary(section) }}</span>
      </button>
      <p class="mt-2 px-2 text-[10px] leading-relaxed text-muted">{{ panels.rulesHere }}</p>
    </div>

    <!-- Открытый блок: слева редактор, справа рендер. -->
    <div v-else class="flex min-h-0 flex-1 flex-col gap-2">
      <div class="flex items-center gap-2">
        <AppButton size="xs" variant="ghost" @click="opened = null">
          {{ common.back }}
        </AppButton>
        <span class="text-[11px] font-semibold text-surface">{{ sectionTitles[opened] }}</span>
      </div>

      <div class="grid min-h-0 flex-1 grid-cols-2 gap-3">
        <AppTextarea
          v-model="draft[opened]"
          data-test-id="rules-editor-input"
          class="h-full resize-none font-mono"
          :rows="14"
        />
        <div
          data-test-id="rules-preview"
          class="min-h-0 overflow-y-auto rounded border border-border bg-panel-field px-3 py-2"
        >
          <ChatMarkdown v-if="preview" :content="preview" />
          <p v-else class="text-[11px] text-muted">{{ panels.rulesBlockEmpty }}</p>
        </div>
      </div>

      <p class="text-[10px] text-muted">{{ hint }}</p>
    </div>

    <template #footer>
      <AppButton size="sm" variant="ghost" @click="open = false">{{ common.cancel }}</AppButton>
      <AppButton
        size="sm"
        color="primary"
        variant="solid"
        data-test-id="rules-save"
        :disabled="!owner"
        @click="save"
      >
        {{ common.save }}
      </AppButton>
    </template>
  </AppDialog>
</template>
