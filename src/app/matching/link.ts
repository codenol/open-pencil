import type { EditorStore } from '@/app/editor/session'

import type { MatchCandidate, MatchRow } from './table'

export interface MaterializedMaster {
  componentId: string
  componentSetId: string | null
}

export type MaterializeMaster = (
  libraryId: string,
  revisionId: string,
  assetKey: string
) => Promise<MaterializedMaster | null | undefined>

/**
 * Связывание копии с мастером: инстансы, ссылающиеся на компонент/варианты копии,
 * переводятся на мастера (или его варианты — по совпадению имён), а копия помечается
 * связанной с библиотекой. После этого обновления источника доходят до этого файла.
 */
export async function linkComponentToMaster(
  store: EditorStore,
  row: MatchRow,
  candidate: MatchCandidate,
  materialize?: MaterializeMaster
): Promise<number> {
  const graph = store.graph
  let masterComponentId = candidate.nodeId ?? null
  let masterSetId: string | null = null

  if (!masterComponentId && candidate.libraryId && candidate.revisionId && candidate.assetKey) {
    const result = await materialize?.(candidate.libraryId, candidate.revisionId, candidate.assetKey)
    masterComponentId = result?.componentId ?? null
    masterSetId = result?.componentSetId ?? null
  }
  if (!masterComponentId) throw new Error('Мастер не найден')

  const copy = graph.getNode(row.nodeId)
  if (!copy) throw new Error('Компонент не найден')

  const targets = new Set(copy.type === 'COMPONENT_SET' ? copy.childIds : [row.nodeId])
  const masterVariants = new Map<string, string>()
  if (masterSetId) {
    for (const childId of graph.getNode(masterSetId)?.childIds ?? []) {
      const child = graph.getNode(childId)
      if (child) masterVariants.set(child.name.trim(), childId)
    }
  } else {
    const master = graph.getNode(masterComponentId)
    const parent = master?.parentId ? graph.getNode(master.parentId) : undefined
    if (parent?.type === 'COMPONENT_SET') {
      for (const childId of parent.childIds) {
        const child = graph.getNode(childId)
        if (child) masterVariants.set(child.name.trim(), childId)
      }
    }
  }

  let relinked = 0
  for (const [id, node] of graph.nodes) {
    if (node.type !== 'INSTANCE' || !node.componentId) continue
    if (!targets.has(node.componentId)) continue
    const variantName = graph.getNode(node.componentId)?.name.trim() ?? ''
    const masterId = masterVariants.get(variantName) ?? masterComponentId
    graph.updateNode(id, { componentId: masterId })
    relinked += 1
  }

  if (candidate.libraryId && candidate.assetKey && candidate.revisionId) {
    graph.updateNode(row.nodeId, {
      librarySource: {
        identity: {
          libraryId: candidate.libraryId,
          assetKey: candidate.assetKey,
          revisionId: candidate.revisionId
        },
        sourceNodeId: row.nodeId,
        readOnly: true
      }
    })
  }

  store.requestRender()
  return relinked
}
