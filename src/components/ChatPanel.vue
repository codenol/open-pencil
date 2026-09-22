<script setup lang="ts">
import type { Chat } from '@ai-sdk/vue'
import type { UIMessage } from 'ai'
import { computed, onScopeDispose, shallowRef, watch, watchEffect } from 'vue'

import { useI18n } from '@open-pencil/vue'

import { chatDocumentId } from '@/app/ai/chat/history/document'
import { setAssistantBusy } from '@/app/ai/chat/busy'
import { useChatSubmission } from '@/app/ai/chat/submission/use'
import { useAIChat } from '@/app/ai/chat/use'
import { didHitStepLimit } from '@/app/ai/tools'
import { getActiveEditorStore } from '@/app/editor/active-store'
import { openSettingsDialog } from '@/app/settings/dialog'
import { toast } from '@/app/shell/ui'
import { activeTab } from '@/app/tabs'
import ACPPermissionDialog from '@/components/chat/ACPPermissionDialog.vue'
import ChatHistory from '@/components/chat/ChatHistory.vue'
import ChatInput from '@/components/chat/ChatInput.vue'
import ChatTranscript from '@/components/chat/ChatTranscript.vue'
import ProviderSetup from '@/components/chat/ProviderSetup.vue'

const { isConfigured, ensureChat, history, chatFailure, clearChatFailure } = useAIChat()
const { ai } = useI18n()

const chat = shallowRef<Chat<UIMessage> | null>(null)
const submission = useChatSubmission({
  chat,
  ensureChat,
  flush: history.flush,
  clearFailure: clearChatFailure,
  getEditor: getActiveEditorStore,
  messages: computed(() => ({
    openSettings: ai.value.openProviderSettingsAction,
    requestFailed: ai.value.chatRequestFailed,
    visionUnavailable: ai.value.visionModelUnavailable
  })),
  reportError: toast.error,
  openModelSettings: () => openSettingsDialog('ai')
})

let viewGeneration = 0
// Restoring local history must not open a provider connection or read credentials.
void history.initialize().catch(() => {
  toast.error(ai.value.chatHistoryFailed)
})

const messages = computed(() => chat.value?.messages ?? history.messages.value)
const historyOptions = computed(() => {
  const current = history.current.value
  const rows = [...history.conversations.value]
  if (current && !rows.some((row) => row.id === current.id)) rows.unshift(current)
  return rows.map((conversation) => ({
    ...conversation,
    available: conversation.documentId === chatDocumentId(getActiveEditorStore())
  }))
})
const agentHistoryReadOnly = computed(
  () => !chat.value && messages.value.length > 0 && history.current.value?.backend !== 'direct'
)
async function historyAction(action: () => Promise<unknown>) {
  const generation = ++viewGeneration
  submission.cancel()
  try {
    await chat.value?.stop()
    await action()
    if (generation !== viewGeneration) return
    chat.value = null
  } catch {
    toast.error(ai.value.chatHistoryFailed)
  }
}

async function renameConversation(id: string, title: string) {
  try {
    await history.rename(id, title)
  } catch {
    toast.error(ai.value.chatHistoryFailed)
  }
}

const failureMessage = computed(() => {
  switch (chatFailure.value?.reason) {
    case 'authentication':
      return ai.value.chatAuthenticationFailed
    case 'forbidden':
      return ai.value.chatForbidden
    case 'insufficient-credit':
      return ai.value.chatInsufficientCredit
    case 'model-not-found':
      return ai.value.chatModelNotFound
    case 'network':
      return ai.value.chatNetworkFailed
    case 'output-limit':
      return ai.value.chatOutputLimit
    case 'rate-limit':
      return ai.value.chatRateLimited
    case 'request-failed':
      return ai.value.chatRequestFailed
    default:
      return null
  }
})
const failureHasSettingsAction = computed(() =>
  ['authentication', 'forbidden', 'model-not-found'].includes(chatFailure.value?.reason ?? '')
)
const status = computed(() => chat.value?.status ?? 'ready')
// Рабочая область гасится, пока ассистент занят: он работает с тем же
// документом, и правки руками в этот момент расходятся с его картиной.
watchEffect(() => {
  setAssistantBusy(status.value === 'submitted' || status.value === 'streaming')
})
// При уходе панели работу не обрываем: счётчик времени должен остаться
// на экране, чтобы было видно, сколько она заняла. Сбрасывает его только
// начало следующей работы.

/**
 * Не даём браузеру усыпить вкладку, пока ассистент работает.
 *
 * Шаги идут через сеть, и в фоновой вкладке браузер режет таймеры: работа
 * встаёт до возвращения на вкладку. Экранная блокировка удерживает вкладку
 * активной. Запрашиваем только на переходе «начал работать», иначе браузер
 * получает запросы на каждое изменение состояния.
 */
let wakeLock: { release: () => Promise<void> } | null = null

function acquireWakeLock(): void {
  if (wakeLock || !navigator.wakeLock) return
  navigator.wakeLock
    .request('screen')
    .then((lock) => {
      wakeLock = lock
    })
    .catch(() => {
      wakeLock = null
    })
}

function releaseWakeLock(): void {
  const lock = wakeLock
  wakeLock = null
  void lock?.release().catch(() => undefined)
}

watch(
  () => status.value === 'submitted' || status.value === 'streaming',
  (busy) => (busy ? acquireWakeLock() : releaseWakeLock())
)
onScopeDispose(releaseWakeLock)
const showContinue = computed(() => {
  if (history.readOnly.value || agentHistoryReadOnly.value) return false
  if (status.value !== 'ready') return false
  if (messages.value.length === 0) return false
  const last = messages.value[messages.value.length - 1]
  return last.role === 'assistant' && didHitStepLimit()
})

watch(
  () => chatFailure.value?.reason,
  (reason) => {
    if (!reason) return
    toast.error(
      failureMessage.value ?? ai.value.chatRequestFailed,
      failureHasSettingsAction.value
        ? {
            label: ai.value.openProviderSettingsAction,
            run: () => openSettingsDialog('ai')
          }
        : undefined
    )
  }
)
watch(
  () => [activeTab.value?.id, activeTab.value?.store.state.preparation] as const,
  async ([, preparation]) => {
    if (preparation) {
      viewGeneration++
      submission.cancel()
      return
    }
    const generation = ++viewGeneration
    submission.cancel()
    chat.value = null
    try {
      await history.initialize()
    } catch {
      if (generation === viewGeneration) toast.error(ai.value.chatHistoryFailed)
    }
  }
)

function handleStop() {
  // Останавливаем сразу, до всякой другой работы: пока поток занят
  // пересчётом, обработчик может не дойти, а остановка нужна немедленно.
  void chat.value?.stop().catch(() => undefined)
  submission.stop()
}
</script>

<template>
  <div data-test-id="chat-panel" class="flex min-w-0 flex-1 flex-col overflow-hidden select-text">
    <ChatHistory
      :saved="history.conversations.value.some((row) => row.id === history.current.value?.id)"
      :conversations="historyOptions"
      :selected-id="history.current.value?.id"
      :disabled="history.busy.value"
      @create="historyAction(history.newChat)"
      @select="historyAction(() => history.open($event))"
      @rename="renameConversation"
      @delete="historyAction(() => history.remove($event))"
    />
    <p v-if="history.storageError.value" role="alert" class="px-3 py-2 text-xs text-red-400">
      {{ ai.chatStorageFailed }}
    </p>
    <ProviderSetup v-if="!isConfigured" />

    <template v-if="isConfigured || messages.length">
      <p
        v-if="history.current.value?.interrupted && status === 'ready'"
        role="status"
        class="px-3 py-2 text-xs text-muted"
      >
        {{ ai.chatInterrupted }}
      </p>
      <ChatTranscript
        :messages="messages"
        :status="status"
        :show-continue="showContinue"
        @continue="
          submission.submit({
            modelText: 'Continue where you left off',
            displayText: 'Continue where you left off',
            images: [],
            nodes: []
          })
        "
      />

      <p v-if="agentHistoryReadOnly" role="status" class="px-3 py-2 text-xs text-muted">
        {{ ai.chatAgentReadOnly }}
      </p>
      <p v-if="history.readOnly.value" role="status" class="px-3 py-2 text-xs text-muted">
        {{ ai.chatReadOnly }}
      </p>
      <ChatInput
        v-if="isConfigured && !agentHistoryReadOnly && !history.readOnly.value"
        :status="status"
        :disabled="submission.busy.value || history.busy.value"
        @submit="submission.submit"
        @stop="handleStop"
        @error="toast.error"
      />

      <ACPPermissionDialog />
    </template>
  </div>
</template>
