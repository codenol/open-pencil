<script setup lang="ts">
import { useTextareaAutosize } from '@vueuse/core'
import type { ChatStatus } from 'ai'
import { TooltipProvider } from 'reka-ui'
import { computed, onScopeDispose, ref, watch } from 'vue'

import { useI18n } from '@open-pencil/vue'

import IconButton from '@/components/ui/button/IconButton.vue'
import InputGroup from '@/components/ui/input/InputGroup.vue'
const { status, disabled = false } = defineProps<{ status: ChatStatus; disabled?: boolean }>()
const emit = defineEmits<{
  submit: [text: string]
  stop: []
  settings: []
  paste: [event: ClipboardEvent]
}>()
const { ai } = useI18n()
const textarea = ref<HTMLTextAreaElement>()
const input = ref('')
const { triggerResize } = useTextareaAutosize({ element: textarea, input, maxHeight: 160 })
const isStreaming = computed(() => disabled || status === 'streaming' || status === 'submitted')

/**
 * Сколько идёт текущая работа.
 *
 * Отправка и сборка занимают минуты, и без счётчика непонятно, идёт процесс
 * или встал. Считаем от начала работы и обнуляем по её окончании.
 */
const elapsed = ref(0)
/** Время последней законченной работы: остаётся на экране, пока не начнётся новая. */
const lastRun = ref(0)
let timer: ReturnType<typeof setInterval> | undefined

watch(isStreaming, (active) => {
  clearInterval(timer)
  if (!active) {
    // Не обнуляем: по окончании работы видно, сколько она заняла.
    lastRun.value = elapsed.value
    return
  }
  const startedAt = Date.now()
  elapsed.value = 0
  lastRun.value = 0
  timer = setInterval(() => (elapsed.value = Date.now() - startedAt), 1000)
})

onScopeDispose(() => clearInterval(timer))

/** Показываем текущее время работы, а после — сколько она заняла. */
const shownTime = computed(() => (isStreaming.value ? elapsed.value : lastRun.value))

/** Минуты и секунды: `1:07`, `0:12`. */
const elapsedLabel = computed(() => {
  const total = Math.floor(shownTime.value / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
})
function handleInputKeydown(event: KeyboardEvent) {
  if (event.code !== 'Enter' || event.shiftKey || event.isComposing) return
  event.preventDefault()
  const target = event.currentTarget
  if (target instanceof HTMLElement) target.closest('form')?.requestSubmit()
}
function handleSubmit(event: Event) {
  event.preventDefault()
  if (isStreaming.value) return
  const text = input.value.trim()
  if (!text) return
  emit('submit', text)
  input.value = ''
  triggerResize()
}
</script>
<template>
  <TooltipProvider>
    <div class="shrink-0 border-t border-border p-2.5">
      <form @submit="handleSubmit" @paste.stop="emit('paste', $event)">
        <InputGroup :disabled="isStreaming">
          <template v-if="$slots.attachment" #attachment><slot name="attachment" /></template>

          <textarea
            ref="textarea"
            v-model="input"
            data-test-id="chat-input"
            :placeholder="ai.describeChange"
            :disabled="isStreaming"
            rows="2"
            :aria-label="ai.describeChange"
            class="block min-h-12 w-full resize-none overflow-y-auto bg-transparent px-3 pt-2.5 pb-1 text-xs leading-relaxed text-surface outline-none placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-60"
            @keydown="handleInputKeydown"
            @copy.stop
            @cut.stop
          />

          <template #leading><slot name="leading" /></template>

          <template #model><slot name="model" /></template>

          <template #actions>
            <span
              v-if="shownTime > 0"
              :data-test-id="isStreaming ? 'chat-elapsed' : 'chat-elapsed-done'"
              class="mr-0.5 text-[11px] tabular-nums text-muted"
              :title="isStreaming ? ai.generating : ai.lastRunTime"
            >
              {{ isStreaming ? elapsedLabel : `${ai.took} ${elapsedLabel}` }}
            </span>
            <IconButton
              :label="ai.providerSettings"
              size="sm"
              data-test-id="provider-settings-trigger"
              @click="emit('settings')"
            >
              <icon-lucide-settings class="size-3.5" />
            </IconButton>
            <IconButton
              v-if="isStreaming"
              :label="ai.stopGenerating"
              size="sm"
              data-test-id="chat-stop-button"
              class="border border-border"
              @click="emit('stop')"
            >
              <icon-lucide-square class="size-3" />
            </IconButton>
            <IconButton
              v-else
              :label="ai.sendMessage"
              size="sm"
              type="submit"
              data-test-id="chat-send-button"
              class="bg-accent text-white hover:bg-accent/90 hover:text-white"
              :disabled="!input.trim()"
            >
              <icon-lucide-send class="size-3.5" />
            </IconButton>
          </template>
        </InputGroup>
      </form>
    </div>
  </TooltipProvider>
</template>
