import { tool } from 'ai'

import { registerComponentCatalog, isAtomicTool, toolsToAI } from '@open-pencil/core/tools'
import type { StepBudget } from '@open-pencil/core/tools'
import type { SceneNode } from '@open-pencil/scene-graph'

import { DEFAULT_AGENT_STEPS, resolveAgentStepLimit } from '@/app/ai/chat/step-limit'
import { makeFigmaFromStore } from '@/app/automation/bridge/figma-factory'
import { executeAtomicEditorTool } from '@/app/automation/execution/editor'
import { recordToolCompleted, type AIDiagnosticContext } from '@/app/diagnostics/events/ai'
import { getActiveEditorStore } from '@/app/editor/active-store'
import type { EditorStore } from '@/app/editor/active-store'
import { ensureGraphFonts } from '@/app/editor/fonts'
import { useLibraryService } from '@/app/libraries'

import { aiToolDefinitions } from './catalog'

class RunState {
  currentSteps = 0
  /**
/** Captured for the message in progress; settings changes apply to the next one. */
  maxSteps = DEFAULT_AGENT_STEPS

  resetSteps(maxSteps: number): void {
    this.currentSteps = 0
    this.maxSteps = resolveAgentStepLimit(maxSteps)
  }

  /**
   * Прогон закончился сам, а не был доведён до конца.
   *
   * Ставится, когда поток оборвался: браузер усыпил вкладку, провайдер
   * отказал, вкладку закрыли. Работа при этом сделана наполовину, и её надо
   * уметь продолжить — иначе ассистент «остановился и дальше не идёт», а
   * кнопка продолжения не показывается, потому что лимит шагов не достигнут.
   */
  unfinished = false

  hitLimit(): boolean {
    return this.currentSteps >= this.maxSteps
  }

  markUnfinished(value: boolean): void {
    this.unfinished = value
  }

  isUnfinished(): boolean {
    return this.unfinished
  }
}

const runStates = new WeakMap<EditorStore, RunState>()

function getRunState(store?: EditorStore): RunState {
  const target = store ?? getActiveEditorStore()
  const existing = runStates.get(target)
  if (existing) return existing
  const created = new RunState()
  runStates.set(target, created)
  return created
}

export function recordStep(store?: EditorStore): void {
  getRunState(store).currentSteps++
}

export function resetRunSteps(store: EditorStore, maxSteps: number): void {
  getRunState(store).resetSteps(maxSteps)
}

export function didHitStepLimit(store?: EditorStore): boolean {
  return getRunState(store).hitLimit()
}

/** Прогон оборвался, не дойдя до конца — работу можно продолжить. */
export function didRunStopEarly(store?: EditorStore): boolean {
  return getRunState(store).isUnfinished()
}

export function markRunUnfinished(value: boolean, store?: EditorStore): void {
  getRunState(store).markUnfinished(value)
}

export function createAITools(store: EditorStore, diagnosticContext?: AIDiagnosticContext) {
  let beforeSnapshot: Map<string, SceneNode> | null = null
  let snapshotTargets: string[] = []
  const runState = getRunState(store)
  const libraryService = useLibraryService()
  libraryService.bindEditor(store)
  registerComponentCatalog(store.graph, libraryService)

  return toolsToAI(
    aiToolDefinitions,
    {
      getFigma: () => makeFigmaFromStore(store),
      executeTool: async (def, figma, args) => {
        if (isAtomicTool(def)) {
          return executeAtomicEditorTool(store, figma, def, args, { label: 'AI' })
        }
        if (def.mutates) {
          snapshotTargets = collectTargetIds(args);
          beforeSnapshot = captureAffected(store, figma, args)
        }
        return def.mutates
          ? store.runMutationWithLayout(
              () => def.execute(figma, args),
              figma.currentPageId,
              async () => {
                const pageNode = store.graph.getNode(figma.currentPageId)
                if (pageNode) await ensureGraphFonts(store.graph, pageNode.childIds, store.renderer)
              }
            )
          : def.execute(figma, args)
      },
      onAfterExecute: async (def, figma) => {
        if (isAtomicTool(def)) return
        if (def.mutates) {
          store.requestRender()
          if (beforeSnapshot) {
            const before = beforeSnapshot
            const after = captureAffected(store, figma, Object.fromEntries(snapshotTargets.map((id, i) => [`ids_${i}`, id])))
            store.pushUndoEntry({
              label: `AI: ${def.name}`,
              forward: () => store.restorePageFromSnapshot(after),
              inverse: () => store.restorePageFromSnapshot(before)
            })
            beforeSnapshot = null
          }
        }
      },
      onFlashNodes: (nodeIds) => {
        store.renderer?.aiClearActive()
        if (nodeIds.length > 0) {
          store.aiFlashDone(nodeIds)
        }
      },
      onToolLog: (entry) => {
        recordToolCompleted(
          {
            tool: entry.tool,
            durationMs: entry.durationMs,
            mutates: entry.mutates,
            failed: Boolean(entry.error)
          },
          diagnosticContext
        )
      },
      getStepBudget: (): StepBudget => ({
        current: runState.currentSteps,
        max: runState.maxSteps
      })
    },
    { tool }
  )
}

export type AITools = ReturnType<typeof createAITools>

/** Собирает id из аргументов вызова. */
function collectTargetIds(args: Record<string, unknown>): string[] {
  const ids: string[] = []
  for (const key of ['id', 'node_id', 'nodeId', 'ids', 'node_ids', 'source_id', 'target_id', 'parent_id']) {
    const value = args[key]
    if (typeof value === 'string') ids.push(value)
    else if (Array.isArray(value)) ids.push(...value.filter((v): v is string => typeof v === 'string'))
  }
  return ids
}

function captureAffected(
  store: EditorStore,
  figma: unknown,
  args: Record<string, unknown>
): Map<string, SceneNode> {
  const ids: string[] = []
  for (const key of ['id', 'node_id', 'nodeId', 'ids', 'node_ids', 'source_id', 'target_id', 'parent_id']) {
    const value = args[key]
    if (typeof value === 'string') ids.push(value)
    else if (Array.isArray(value)) ids.push(...value.filter((v): v is string => typeof v === 'string'))
  }
  if (ids.length === 0) {
    const current = (figma as { currentPage?: { selection?: { id: string }[] } }).currentPage
    for (const node of current?.selection ?? []) ids.push(node.id)
  }
  if (ids.length === 0) return store.snapshotPage()

  const graph = store.graph
  // Узлы и их окружение: правка может задеть родителя и соседей по раскладке.
  const wanted = new Set<string>()
  for (const id of ids) {
    const node = graph.getNode(id)
    if (!node) continue
    wanted.add(id)
    if (node.parentId) wanted.add(node.parentId)
    for (const childId of node.childIds) wanted.add(childId)
  }
  if (wanted.size === 0) return store.snapshotPage()

  const snapshot = new Map<string, SceneNode>()
  for (const id of wanted) {
    const node = graph.getNode(id)
    if (node) snapshot.set(id, { ...node })
  }
  return snapshot
}
