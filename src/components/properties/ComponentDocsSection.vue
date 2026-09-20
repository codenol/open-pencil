<script setup lang="ts">
/**
 * Документация компонента ДС: описание, гайдлайны «как можно», гардрейлы «как нельзя».
 * Правится прямо в свойствах — как заливка. Сохраняется вместе с компонентом
 * и уезжает в библиотеку при публикации. Материал машиночитаем: LLM может
 * проверять, не нарушает ли макет правила дизайн-системы.
 */
import { computed, ref, watch } from 'vue'

import { useEditor, useI18n, useSelectionState } from '@open-pencil/vue'

type DocsField = 'symbolDescription' | 'symbolGuidelines' | 'symbolGuardrails'

const editor = useEditor()
const { selectedNode: node } = useSelectionState()
const { panels } = useI18n()

const isComponentLike = computed(() => {
  const type = node.value?.type
  return type === 'COMPONENT' || type === 'COMPONENT_SET'
})

const values = ref<Record<DocsField, string>>({
  symbolDescription: '',
  symbolGuidelines: '',
  symbolGuardrails: ''
})

watch(
  node,
  (current) => {
    values.value = {
      symbolDescription: current?.symbolDescription ?? '',
      symbolGuidelines: current?.symbolGuidelines ?? '',
      symbolGuardrails: current?.symbolGuardrails ?? ''
    }
  },
  { immediate: true }
)

const fields = computed<
  Array<{ key: DocsField; label: string; hint: string; testId: string }>
>(() => [
  {
    key: 'symbolDescription',
    label: panels.value.docDescription,
    hint: panels.value.docDescriptionHint,
    testId: 'component-doc-description'
  },
  {
    key: 'symbolGuidelines',
    label: panels.value.docGuidelines,
    hint: panels.value.docGuidelinesHint,
    testId: 'component-doc-guidelines'
  },
  {
    key: 'symbolGuardrails',
    label: panels.value.docGuardrails,
    hint: panels.value.docGuardrailsHint,
    testId: 'component-doc-guardrails'
  }
])

function apply(field: DocsField) {
  const current = node.value
  if (!current) return
  const value = values.value[field]
  const previous = current[field]
  if (previous === value) return
  // updateNode применяет новое значение, commitNodeUpdate пишет шаг отмены
  // (в него передаётся прежнее значение).
  editor.updateNode(current.id, { [field]: value })
  editor.commitNodeUpdate(current.id, { [field]: previous }, 'Изменить документацию компонента')
}
</script>

<template>
  <section
    v-if="isComponentLike"
    data-test-id="component-docs"
    class="flex flex-col gap-2 border-b border-border px-3 py-2"
  >
    <span class="text-[10px] font-semibold uppercase tracking-wide text-muted">
      {{ panels.documentation }}
    </span>
    <label v-for="field in fields" :key="field.key" class="flex flex-col gap-1">
      <span class="text-[10px] text-muted">{{ field.label }}</span>
      <textarea
        v-model="values[field.key]"
        :data-test-id="field.testId"
        :placeholder="field.hint"
        rows="3"
        class="scrollbar-thin resize-y rounded border border-border bg-input px-2 py-1.5 text-[11px] leading-snug text-surface outline-none placeholder:text-muted focus:border-accent"
        @blur="apply(field.key)"
      />
    </label>
  </section>
</template>
