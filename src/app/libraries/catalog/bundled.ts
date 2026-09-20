import {
  decodeLibraryValue,
  deserializeLibraryRevision,
  type ComponentLibraryRevision,
  type LibrarySummary,
  type PublishLibraryInput,
  type StoredLibraryLatestManifest
} from '@open-pencil/core/library'

import { LocalLibraryCatalog } from './local'

const BASE = import.meta.env.BASE_URL || '/'
const CATALOG_BASE = `${BASE}library-catalog`.replace(/\/{2,}/g, '/').replace(/\/$/, '')
const FORMAT_QUERY = 'fmt=codec-v1'

/** Старые сборки писали бинарные поля без кодека — такие ревизии нужно перекачать. */
function hasRawGeometry(value: unknown): boolean {
  if (!Array.isArray(value)) return false
  return value.some((path) => {
    if (!path || typeof path !== 'object') return false
    const blob = (path as { commandsBlob?: unknown }).commandsBlob
    return blob !== undefined && blob !== null && !(blob instanceof Uint8Array)
  })
}

function isRevisionReadable(revision: ComponentLibraryRevision): boolean {
  for (const [, node] of revision.graph.nodes) {
    const record = node as {
      fillGeometry?: unknown
      strokeGeometry?: unknown
      textPicture?: unknown
      derivedTextGlyphs?: unknown
    }
    if (hasRawGeometry(record.fillGeometry) || hasRawGeometry(record.strokeGeometry)) return false
    if (record.textPicture != null && !(record.textPicture instanceof Uint8Array)) return false
    if (Array.isArray(record.derivedTextGlyphs)) {
      for (const glyph of record.derivedTextGlyphs) {
        const blob = (glyph as { commandsBlob?: unknown } | null)?.commandsBlob
        if (blob != null && !(blob instanceof Uint8Array)) return false
      }
    }
  }
  return true
}

/**
 * «Встроенный» каталог: локальные библиотеки пользователя плюс библиотеки из поставки
 * (дизайн-система и иконки из /library-catalog/). Ревизии поставки скачиваются лениво
 * при подключении и кэшируются в локальном хранилище браузера.
 */
export class BundledLibraryCatalog extends LocalLibraryCatalog {
  #summaries: LibrarySummary[] | null = null
  #remoteIds: Set<string> | null = null

  async #loadSummaries(): Promise<LibrarySummary[]> {
    if (this.#summaries) return this.#summaries
    try {
      const response = await fetch(`${CATALOG_BASE}/libraries.json`, { cache: 'no-cache' })
      if (!response.ok) throw new Error(`http ${response.status}`)
      const data = (await response.json()) as LibrarySummary[]
      this.#summaries = Array.isArray(data) ? data : []
    } catch {
      this.#summaries = []
    }
    this.#remoteIds = new Set(this.#summaries.map((summary) => summary.libraryId))
    return this.#summaries
  }

  async isBundled(libraryId: string): Promise<boolean> {
    await this.#loadSummaries()
    return this.#remoteIds?.has(libraryId) ?? false
  }

  /** Есть ли ревизия библиотеки уже в локальном кэше (без обращения к сети). */
  async hasCachedRevision(libraryId: string): Promise<boolean> {
    try {
      await super.getRevision(libraryId)
      return true
    } catch {
      return false
    }
  }

  async listLibraries(): Promise<LibrarySummary[]> {
    const [bundled, local] = await Promise.all([this.#loadSummaries(), super.listLibraries()])
    const merged = new Map<string, LibrarySummary>()
    for (const summary of local) merged.set(summary.libraryId, summary)
    for (const summary of bundled) merged.set(summary.libraryId, summary)
    return [...merged.values()]
  }

  async getRevision(libraryId: string, revisionId?: string): Promise<ComponentLibraryRevision> {
    if (!(await this.isBundled(libraryId))) return super.getRevision(libraryId, revisionId)
    try {
      const cached = await super.getRevision(libraryId, revisionId)
      if (isRevisionReadable(cached)) return cached
      // Кэш в устаревшем формате — перекачаем и перезапишем ниже.
    } catch {
      // нет в кэше — качаем из поставки
    }
    const manifest = await fetch(`${CATALOG_BASE}/${libraryId}/manifest.json?${FORMAT_QUERY}`, {
      cache: 'no-cache'
    }).then((response) =>
      response.ok ? (response.json() as Promise<StoredLibraryLatestManifest>) : null
    )
    const resolvedRevisionId = revisionId ?? manifest?.summary?.latestRevisionId
    if (!resolvedRevisionId) throw new Error(`Library revision not found: ${libraryId}`)
    const response = await fetch(
      `${CATALOG_BASE}/${libraryId}/revisions/${resolvedRevisionId}.json?${FORMAT_QUERY}`,
      { cache: 'force-cache' }
    )
    if (!response.ok)
      throw new Error(`Library revision not found: ${libraryId}/${resolvedRevisionId}`)
    const raw = (await response.json()) as unknown
    const stored = decodeLibraryValue(raw) as Parameters<typeof deserializeLibraryRevision>[0]
    const revision = deserializeLibraryRevision(stored)
    await super.cacheRevision(revision, true)
    return revision
  }

  async publishRevision(input: PublishLibraryInput): Promise<ComponentLibraryRevision> {
    if (await this.isBundled(input.libraryId)) {
      throw new Error('Встроенную библиотеку нельзя перезаписать — создайте свою')
    }
    return super.publishRevision(input)
  }
}
