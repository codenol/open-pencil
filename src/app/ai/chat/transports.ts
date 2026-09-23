import { Chat } from '@ai-sdk/vue'
import { DirectChatTransport, stepCountIs, ToolLoopAgent } from 'ai'
import type { ChatTransport, FinishReason, LanguageModel, UIMessage } from 'ai'
import type { ComputedRef, Ref } from 'vue'
import { ref } from 'vue'

import { ACP_AGENTS } from '@open-pencil/core/constants'
import type { ACPAgentID, AIProviderID } from '@open-pencil/core/constants'

import { classifyAIChatError, type AIChatFailure } from '@/app/ai/chat/failure'
import { resolveLanguageModelID } from '@/app/ai/chat/model'
import { buildReasoningProviderOptions, type AIProviderOptions } from '@/app/ai/chat/reasoning'
import { compressStepHistory, KEEP_FULL_MESSAGES } from '@/app/ai/chat/compress-history'
import { activeSystemPrompt } from '@/app/ai/chat/prompt-settings'
import { createAIModelRuntime, resolveModelConnectionAPIKey } from '@/app/ai/models'
import { createAITools, markRunUnfinished, recordStep, resetRunSteps } from '@/app/ai/tools'
import { enabledAIToolDefinitions } from '@/app/ai/tools/catalog'
import { aiToolOverrides } from '@/app/ai/tools/preferences'
import {
  recordChatCompleted,
  recordChatFailed,
  recordModelStepCompleted
} from '@/app/diagnostics/events'
import type { AIDiagnosticContext } from '@/app/diagnostics/events/ai'
import type { getActiveEditorStore } from '@/app/editor/active-store'

import { resumableTransport } from './history/continuation'
import { maxAgentSteps } from './preferences'

type EditorStore = ReturnType<typeof getActiveEditorStore>

type ChatSessionOptions = {
  isConfigured: ComputedRef<boolean>
  isACPProvider: ComputedRef<boolean>
  isHarnessProvider: ComputedRef<boolean>
  providerID: Ref<AIProviderID>
  credentialsReady: Promise<void>
  getActiveEditorStore: () => EditorStore
}

export type ToolLoopTransportOptions = {
  store: EditorStore
  providerID: AIProviderID
  model: LanguageModel
  effectiveModelID: string
  maxOutputTokens: number
  reasoningEffort: string
  onError?: (error: unknown) => void
  diagnosticContext?: AIDiagnosticContext
}

const ANTHROPIC_CACHE_CONTROL = {
  anthropic: { cacheControl: { type: 'ephemeral' } }
} as const

function supportsAnthropicCaching(providerID: AIProviderID, modelID: string): boolean {
  return (
    providerID === 'anthropic' ||
    providerID === 'anthropic-compatible' ||
    (providerID === 'openrouter' && modelID.startsWith('anthropic/'))
  )
}

function mergeProviderOptions(
  cacheOptions: typeof ANTHROPIC_CACHE_CONTROL | undefined,
  reasoningOptions: AIProviderOptions | undefined
): AIProviderOptions | undefined {
  if (!cacheOptions && !reasoningOptions) return undefined
  return { ...cacheOptions, ...reasoningOptions }
}

export async function createACPTransport(providerID: AIProviderID) {
  const agentId = providerID.replace('acp:', '') as ACPAgentID
  const agentDef = ACP_AGENTS.find((a) => a.id === agentId)
  if (!agentDef) throw new Error(`Unknown ACP agent: ${agentId}`)

  const { ACPChatTransport } = await import('@/app/ai/acp/transport')
  const { homeDir } = await import('@tauri-apps/api/path')
  return new ACPChatTransport({ agentDef, cwd: await homeDir() })
}

export function createToolLoopTransport({
  store,
  providerID,
  model,
  effectiveModelID,
  maxOutputTokens,
  reasoningEffort,
  onError,
  diagnosticContext = {}
}: ToolLoopTransportOptions) {
  const tools = createAITools(store, diagnosticContext)
  const cacheProviderOptions = supportsAnthropicCaching(providerID, effectiveModelID)
    ? ANTHROPIC_CACHE_CONTROL
    : undefined
  const providerOptions = mergeProviderOptions(
    cacheProviderOptions,
    buildReasoningProviderOptions(providerID, reasoningEffort)
  )

  const agent = new ToolLoopAgent({
    model,
    instructions: activeSystemPrompt(),
    tools,
    maxOutputTokens,
    providerOptions,
    prepareCall: (options) => {
      const stepLimit = maxAgentSteps.value
      const enabledNames = new Set(
        enabledAIToolDefinitions(aiToolOverrides.value).map((tool) => tool.name)
      )
      resetRunSteps(store, stepLimit)
      return {
        ...options,
        stopWhen: stepCountIs(stepLimit),
        // Keep the full catalog for validating history; offer only enabled tools to this request.
        tools: Object.fromEntries(Object.entries(tools).filter(([name]) => enabledNames.has(name))),
        maxOutputTokens,
        providerOptions
      }
    },
    /**
     * Перед каждым шагом подрезаем историю.
     *
     * Ответы инструментов бывают большими (разбор узла, справка по рендеру),
     * а шагов до пятидесяти. Без подрезки запрос растёт с каждым шагом и на
     * середине задачи становится таким, что браузер не справляется — работа
     * встаёт намертво. Оставляем свежие шаги целиком, старые — только имена
     * вызовов и короткие итоги.
     */
    prepareStep: ({ steps, messages }) => {
      const compressed = compressStepHistory(messages, steps.length * 2 - KEEP_FULL_MESSAGES)
      return compressed === messages ? undefined : { messages: compressed }
    },
    onStepFinish: ({ usage }) => {
      recordStep(store)
      recordModelStepCompleted(
        {
          provider: providerID,
          model: effectiveModelID,
          inputTokens: usage.inputTokens ?? null,
          outputTokens: usage.outputTokens ?? null,
          cacheReadTokens: usage.inputTokenDetails.cacheReadTokens ?? null,
          cacheWriteTokens: usage.inputTokenDetails.cacheWriteTokens ?? null
        },
        diagnosticContext
      )
    }
  })

  return resumableTransport(
    new DirectChatTransport({
      agent,
      onError: (error) => {
        onError?.(error)
        // Разбираем, что именно ответил провайдер. Общая фраза уводит в сторону:
        // ассистент видит отказ, решает, что дело в его JSX, и правит то, что
        // не сломано. Чаще всего отказ приходит на слишком большой запрос.
        const detail = describeProviderError(error)
        return detail
      }
    }) as ChatTransport<UIMessage>
  )
}

/**
 * Переводит отказ провайдера в понятную фразу.
 *
 * Провайдеры отвечают по-разному: размер запроса, лимит частоты, ключ, модель.
 * Без разбора ассистент считает любой отказ ошибкой своего кода и начинает
 * править рабочий JSX — мы это уже видели.
 */
export function describeProviderError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error ?? '')
  const lower = text.toLowerCase()
  if (/context|token|too large|length|payload/.test(lower)) {
    return `The provider refused the request: it is too large — likely the accumulated context. Report this to the user and stop; do not retry the same call or change the JSX. Detail: ${text.slice(0, 200)}`
  }
  if (/rate|429|quota|limit/.test(lower)) {
    return `The provider refused the request: rate or quota limit. Wait and retry once. Detail: ${text.slice(0, 200)}`
  }
  if (/auth|key|401|403|forbidden/.test(lower)) {
    return `The provider refused the request: credentials. Ask the user to check the model settings. Detail: ${text.slice(0, 200)}`
  }
  if (/model|404/.test(lower)) {
    return `The provider refused the request: the model may be unavailable. Ask the user to check the model settings. Detail: ${text.slice(0, 200)}`
  }
  return `The provider refused the request. Do not change your JSX because of this. Detail: ${text.slice(0, 200)}`
}

export function createChatSessionManager({
  isConfigured,
  isACPProvider,
  isHarnessProvider,
  providerID,
  credentialsReady,
  getActiveEditorStore
}: ChatSessionOptions) {
  const failure = ref<AIChatFailure | null>(null)
  let transportDirty = false
  let currentChatStore: EditorStore | null = null
  const currentChatMessages = new WeakMap<EditorStore, UIMessage[]>()
  let chat: Chat<UIMessage> | null = null
  let acpTransportInstance: { destroy(): Promise<void> } | null = null
  let harnessTransportInstance: { stop(): Promise<void> } | null = null
  let overrideTransport: (() => ChatTransport<UIMessage>) | null = null
  let activeProviderError: unknown = null

  function captureProviderError(error: unknown): void {
    activeProviderError ??= error
  }

  /**
   * Снимает запомненный отказ провайдера.
   *
   * Вызывается перед новым шагом: иначе отказ, случившийся один раз, остаётся
   * в памяти и подменяет текст всех последующих ошибок. Мы это видели: вызов
   * `eval` с `1+1` «падал» с сообщением про `figma`, к которому отношения не
   * имел.
   */
  function forgetProviderError(): void {
    activeProviderError = null
  }

  function handleChatFinish(
    context: AIDiagnosticContext,
    {
      finishReason,
      isAbort,
      isDisconnect,
      isError
    }: {
      finishReason?: FinishReason
      isAbort: boolean
      isDisconnect: boolean
      isError: boolean
    }
  ): void {
    if (!isAbort && !isDisconnect && !isError) {
      recordChatCompleted({ finishReason: finishReason ?? null }, context)
      markRunUnfinished(false)
      return
    }
    // Оборвалось до конца работы: браузер усыпил вкладку, провайдер отказал,
    // поток прерван. Работа сделана наполовину, и её надо уметь продолжить —
    // иначе ассистент просто останавливается и ждёт непонятно чего.
    markRunUnfinished(true)
  }

  function clearFailure(): void {
    activeProviderError = null
    failure.value = null
  }

  function markTransportDirty() {
    transportDirty = true
  }

  async function destroyAgentTransports(): Promise<void> {
    const acp = acpTransportInstance
    const harness = harnessTransportInstance
    acpTransportInstance = null
    harnessTransportInstance = null
    const results = await Promise.allSettled([acp?.destroy(), harness?.stop()])
    const errors = results
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason)
    if (errors.length) throw new AggregateError(errors, 'Agent transport teardown failed')
  }

  async function createActiveACPTransport() {
    await destroyAgentTransports()
    const transport = await createACPTransport(providerID.value)
    acpTransportInstance = transport
    return transport as ChatTransport<UIMessage>
  }

  async function createActiveHarnessTransport(sessionId: string) {
    await destroyAgentTransports()
    const runtime = await createAIModelRuntime('design')
    if (runtime?.kind !== 'harness') throw new Error('The Design agent is not configured for Pi')
    const [{ HarnessChatTransport }, { buildPiMCPServers }] = await Promise.all([
      import('@/app/ai/harness/transport'),
      import('@/app/integrations/mcp')
    ])
    const apiKey = await resolveModelConnectionAPIKey(runtime.role.connection.id)
    if (!apiKey) throw new Error('Credential is unavailable for the Pi agent')
    const model = runtime.role.profile.customModelID || runtime.role.profile.modelID
    const transport = new HarnessChatTransport(
      sessionId,
      {
        adapter: 'pi',
        sandbox: 'just-bash',
        model,
        settings: {
          thinkingLevel: runtime.role.profile.harnessThinkingLevel ?? 'medium',
          permissionMode: runtime.role.profile.harnessPermissionMode ?? 'allow-edits'
        },
        instructions: activeSystemPrompt(),
        mcpServers: await buildPiMCPServers()
      },
      { OPENPENCIL_HARNESS_API_KEY: apiKey }
    )
    harnessTransportInstance = transport
    return transport as ChatTransport<UIMessage>
  }

  async function createTransport(store: EditorStore, diagnosticContext: AIDiagnosticContext) {
    if (overrideTransport) return overrideTransport()

    await destroyAgentTransports()

    const runtime = await createAIModelRuntime('design')
    if (runtime?.kind !== 'direct') {
      throw new Error('The Design model is not configured for direct API access')
    }
    return createToolLoopTransport({
      store,
      providerID: runtime.role.connection.providerID,
      model: runtime.model,
      effectiveModelID: resolveLanguageModelID({
        providerID: runtime.role.connection.providerID,
        modelID: runtime.role.profile.modelID,
        customModelID: runtime.role.profile.customModelID
      }),
      maxOutputTokens: runtime.role.profile.maxOutputTokens,
      reasoningEffort: runtime.role.profile.reasoningEffort ?? '',
      onError: captureProviderError,
      diagnosticContext
    })
  }

  async function ensureChat(
    initialMessages?: UIMessage[],
    sessionId = crypto.randomUUID()
  ): Promise<Chat<UIMessage> | null> {
    await credentialsReady
    if (!isConfigured.value) return null

    const store = getActiveEditorStore()
    if (currentChatStore && chat) {
      currentChatMessages.set(currentChatStore, chat.messages)
    }

    if (!chat || transportDirty || currentChatStore !== store) {
      const messages = initialMessages ?? currentChatMessages.get(store)
      const diagnosticContext: AIDiagnosticContext = { sessionId, runId: crypto.randomUUID() }
      let transport: ChatTransport<UIMessage>
      if (isACPProvider.value) transport = await createActiveACPTransport()
      else if (isHarnessProvider.value) transport = await createActiveHarnessTransport(sessionId)
      else transport = await createTransport(store, diagnosticContext)
      chat = new Chat<UIMessage>({
        transport: {
          sendMessages: (options) => {
            diagnosticContext.runId = crypto.randomUUID()
            forgetProviderError()
            return transport.sendMessages(options)
          },
          reconnectToStream: (options) => transport.reconnectToStream(options)
        },
        messages,
        onError: (error) => {
          // Отказ провайдера, пойманый транспортом, точнее того, что приходит
          // сюда. Но он относится только к текущему шагу: если сбросить его
          // негде, он подменяет собой все следующие ошибки — и тогда падение
          // обычного вызова показывает чужой текст. Оставляем его только пока
          // он свежий.
          const reportedError = activeProviderError ?? error
          activeProviderError = null
          failure.value = classifyAIChatError(reportedError)
          recordChatFailed(
            {
              errorName: reportedError instanceof Error ? reportedError.name : 'unknown'
            },
            diagnosticContext
          )
        },
        onFinish: (event) => handleChatFinish(diagnosticContext, event)
      })
      currentChatStore = store
      transportDirty = false
    }
    return chat
  }

  async function resetChat() {
    if (currentChatStore) currentChatMessages.delete(currentChatStore)
    await destroyAgentTransports()
    failure.value = null
    chat = null
    currentChatStore = null
    transportDirty = false
  }

  function setOverrideTransport(factory: (() => ChatTransport<UIMessage>) | null) {
    overrideTransport = factory
    markTransportDirty()
  }

  return { ensureChat, resetChat, markTransportDirty, setOverrideTransport, failure, clearFailure }
}
