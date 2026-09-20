import { getCanvasKit } from '@open-pencil/core/canvaskit'
import { SkiaRenderer } from '@open-pencil/core/canvas'
import { renderNodesToImage } from '@open-pencil/core/io/formats/raster'
import type { SceneGraph } from '@open-pencil/scene-graph'
import type { CanvasKit } from 'canvaskit-wasm'

import { LocalLibraryCatalog } from '@/app/libraries/catalog/local'

/**
 * Превью компонентов для списков («Заменить компонент», панель ассетов): рендерим ноду
 * в маленький PNG — и для компонентов документа, и для библиотечных (из графа ревизии).
 * URL-ы кэшируются, параллельные запросы схлопываются.
 */
const urlCache = new Map<string, string>()
const pending = new Map<string, Promise<string | null>>()
let catalog: LocalLibraryCatalog | null = null

const PREVIEW_SIZE_PX = 20

let previewRenderer: Promise<{ ck: CanvasKit; renderer: SkiaRenderer }> | null = null

function getCatalog(): LocalLibraryCatalog {
  catalog ??= new LocalLibraryCatalog()
  return catalog
}

async function getPreviewRenderer(): Promise<{ ck: CanvasKit; renderer: SkiaRenderer }> {
  previewRenderer ??= (async () => {
    const ck = await getCanvasKit()
    const surface = ck.MakeSurface(1, 1)
    if (!surface) throw new Error('Не удалось создать поверхность для превью')
    const renderer = new SkiaRenderer(ck, surface)
    renderer.viewportWidth = 1
    renderer.viewportHeight = 1
    renderer.dpr = 1
    await renderer.loadFonts()
    return { ck, renderer }
  })()
  return previewRenderer
}

export function pageIdOfNode(graph: SceneGraph, nodeId: string): string | null {
  let node = graph.getNode(nodeId)
  while (node) {
    if (node.type === 'CANVAS') return node.id
    node = node.parentId ? graph.getNode(node.parentId) : undefined
  }
  return null
}

async function renderNode(
  graph: SceneGraph,
  nodeId: string,
  sizePx = PREVIEW_SIZE_PX
): Promise<string | null> {
  const node = graph.getNode(nodeId)
  const pageId = pageIdOfNode(graph, nodeId)
  if (!node || !pageId) return null
  const maxDimension = Math.max(node.width, node.height, 1)
  const scale = Math.min((sizePx * 2) / maxDimension, 4)
  const { ck, renderer } = await getPreviewRenderer()
  renderer.invalidateAllPictures()
  const restore = await renderer.prepareForExport(graph, pageId, [nodeId])
  try {
    const data = renderNodesToImage(ck, renderer, graph, pageId, [nodeId], {
      scale,
      format: 'PNG',
      trimTransparent: true
    })
    return data ? URL.createObjectURL(new Blob([data], { type: 'image/png' })) : null
  } finally {
    restore()
  }
}

/** Превью компонента документа. */
export function documentComponentPreviewUrl(
  nodeId: string,
  graph: SceneGraph
): Promise<string | null> {
  return previewUrl(`doc:${nodeId}`, () => renderNode(graph, nodeId))
}

/** Обложка библиотеки: первый компонент ревизии, крупным планом (для домашней страницы). */
export function libraryCoverPreviewUrl(
  libraryId: string,
  revisionId: string,
  sizePx = 320
): Promise<string | null> {
  return previewUrl(`cover:${libraryId}:${revisionId}:${sizePx}`, async () => {
    const revision = await getCatalog().getRevision(libraryId, revisionId)
    const descriptor = revision.manifest.assets[0]
    if (!descriptor) return null
    return renderNode(revision.graph, descriptor.sourceNodeId, sizePx)
  })
}

/** Превью компонента из библиотечной ревизии. */
export function libraryComponentPreviewUrl(
  libraryId: string,
  revisionId: string,
  assetKey: string
): Promise<string | null> {
  return previewUrl(`lib:${libraryId}:${revisionId}:${assetKey}`, async () => {
    const revision = await getCatalog().getRevision(libraryId, revisionId)
    const descriptor = revision.manifest.assets.find((asset) => asset.key === assetKey)
    if (!descriptor) return null
    return renderNode(revision.graph, descriptor.sourceNodeId)
  })
}

function previewUrl(key: string, load: () => Promise<string | null>): Promise<string | null> {
  const cached = urlCache.get(key)
  if (cached) return Promise.resolve(cached)
  const inflight = pending.get(key)
  if (inflight) return inflight
  const task = load()
    .then((url) => {
      if (url) urlCache.set(key, url)
      return url
    })
    .catch((error) => {
      console.warn('[Component preview] не удалось отрисовать превью:', error)
      return null
    })
    .finally(() => {
      pending.delete(key)
    })
  pending.set(key, task)
  return task
}
