import type { SceneGraph } from '@open-pencil/scene-graph'

/**
 * Таблица соответствия: строки — компоненты файла, приехавшие из других библиотек
 * (копии), с указанием источника и состояния связи. Цель — «прокинуть линки»:
 * сопоставить копию с мастером и перепривязать.
 */

export interface MatchCandidate {
  value: string
  label: string
  group?: string
  kind: 'document' | 'library'
  nodeId?: string
  libraryId?: string
  revisionId?: string
  assetKey?: string
}

export interface MatchRow {
  nodeId: string
  name: string
  kind: 'component' | 'set'
  page: string
  internal: boolean
  sourceLibraryKey: string | null
  componentKey: string | null
  publishId: string | null
  linkedLibraryId: string | null
  instances: number
  candidate: MatchCandidate | null
}

export function normalizeComponentName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/^(fi|u|mdi|feather|unicons):/, '')
    .replace(/\s+/g, '-')
    .replace(/-+$/, '')
}

export function collectMatchRows(graph: SceneGraph, candidates: MatchCandidate[]): MatchRow[] {
  const pages = graph.getPages(true)
  const pageIds = new Set(pages.map((page) => page.id))
  const pageById = new Map(pages.map((page) => [page.id, page]))

  function pageOf(nodeId: string) {
    let current = graph.getNode(nodeId)
    while (current) {
      if (pageIds.has(current.id)) return pageById.get(current.id)
      current = current.parentId ? graph.getNode(current.parentId) : undefined
    }
    return undefined
  }

  const instanceCount = new Map<string, number>()
  for (const [, node] of graph.nodes) {
    if (node.type === 'INSTANCE' && node.componentId) {
      instanceCount.set(node.componentId, (instanceCount.get(node.componentId) ?? 0) + 1)
    }
  }

  const candidatesByName = new Map<string, MatchCandidate>()
  for (const candidate of candidates) {
    const key = normalizeComponentName(candidate.label)
    if (key && !candidatesByName.has(key)) candidatesByName.set(key, candidate)
  }

  const rows: MatchRow[] = []
  for (const [id, node] of graph.nodes) {
    if (node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET') continue
    const parent = node.parentId ? graph.getNode(node.parentId) : undefined
    if (node.type === 'COMPONENT' && parent?.type === 'COMPONENT_SET') continue // варианты — часть сета
    const hasSource = Boolean(
      node.sourceLibraryKey || node.componentKey || node.publishId || node.librarySource
    )
    if (!hasSource) continue
    const page = pageOf(id)
    const targets = node.type === 'COMPONENT_SET' ? node.childIds : [id]
    const instances = targets.reduce((sum, targetId) => sum + (instanceCount.get(targetId) ?? 0), 0)
    const candidate = candidatesByName.get(normalizeComponentName(node.name)) ?? null
    rows.push({
      nodeId: id,
      name: node.name.trim(),
      kind: node.type === 'COMPONENT_SET' ? 'set' : 'component',
      page: page?.name ?? '?',
      internal: Boolean(page?.internalOnly),
      sourceLibraryKey: node.sourceLibraryKey ?? null,
      componentKey: node.componentKey ?? null,
      publishId: node.publishId ?? null,
      linkedLibraryId: node.librarySource?.identity?.libraryId ?? null,
      instances,
      candidate
    })
  }
  rows.sort((a, b) => Number(Boolean(a.linkedLibraryId)) - Number(Boolean(b.linkedLibraryId)) || a.name.localeCompare(b.name))
  return rows
}
