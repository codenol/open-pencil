import type { Canvas } from 'canvaskit-wasm'

import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import type { SkiaRenderer } from '#core/canvas/renderer'
import { createSceneGeometry } from '#core/geometry'

/**
 * Подсветка слотов на канвасе — как в Figma: розовая заливка и обводка.
 *
 * Слот — узел со ссылкой на свойство типа SLOT (`componentPropertyReferences`)
 * или с унаследованной пометкой в pluginData. Список таких узлов ведём
 * инкрементально: полный обход делается один раз на граф, дальше реестр
 * обновляют события узлов — обходить документ на каждый кадр нельзя, в
 * дизайн-системе десятки тысяч узлов.
 */

const SLOT_FILL: [number, number, number, number] = [1, 0.28, 0.58, 0.1]
const SLOT_STROKE: [number, number, number, number] = [1, 0.28, 0.58, 0.9]

interface SlotRegistry {
  ids: Set<string>
}

const registries = new WeakMap<SceneGraph, SlotRegistry>()

function hasSlotMark(node: SceneNode): boolean {
  if (node.componentPropertyReferences?.some((ref) => ref.field === 'SLOT')) return true
  return Boolean(
    node.pluginData?.find(
      (item) => item.pluginId === 'norka.design-system' && item.key === 'slot'
    )
  )
}

function registryFor(graph: SceneGraph): SlotRegistry {
  let registry = registries.get(graph)
  if (registry) return registry

  const ids = new Set<string>()
  for (const node of graph.getAllNodes()) {
    if (hasSlotMark(node)) ids.add(node.id)
  }
  graph.onNodeEvents({
    created: (node) => {
      if (hasSlotMark(node)) ids.add(node.id)
    },
    updated: (id) => {
      const node = graph.getNode(id)
      if (node && hasSlotMark(node)) ids.add(id)
      else ids.delete(id)
    },
    deleted: (id) => {
      ids.delete(id)
    }
  })

  registry = { ids }
  registries.set(graph, registry)
  return registry
}

/**
 * Подсвечиваем только место в мастере: копия слота внутри инстанса розовым
 * не заливается — как в Figma. Заодно проверяем видимость и страницу.
 */
function onCurrentPage(graph: SceneGraph, node: SceneNode, pageId: string): boolean {
  let current: SceneNode | undefined = node
  while (current) {
    if (current.visible === false) return false
    if (current.type === 'INSTANCE') return false
    if (current.type === 'CANVAS') return current.id === pageId
    current = current.parentId ? graph.getNode(current.parentId) : undefined
  }
  return false
}

export function drawSlotHighlights(r: SkiaRenderer, canvas: Canvas, graph: SceneGraph): void {
  const registry = registryFor(graph)
  if (registry.ids.size === 0 || !r.pageId) return
  const pageId = r.pageId

  const geometry = createSceneGeometry(graph)
  const viewLeft = -r.panX / r.zoom
  const viewTop = -r.panY / r.zoom
  const viewRight = viewLeft + r.viewportWidth / r.zoom
  const viewBottom = viewTop + r.viewportHeight / r.zoom

  r.auxStroke.setStrokeWidth(1 / r.zoom)
  r.auxStroke.setColor(r.ck.Color4f(...SLOT_STROKE))
  r.auxStroke.setPathEffect(null)
  r.auxFill.setStyle(r.ck.PaintStyle.Fill)
  r.auxFill.setColor(r.ck.Color4f(...SLOT_FILL))

  for (const id of registry.ids) {
    const node = graph.getNode(id)
    if (!node || node.width <= 0 || node.height <= 0) continue
    if (!onCurrentPage(graph, node, pageId)) continue

    // Кадр целиком за экраном не рисуем.
    const bounds = geometry.bounds(node)
    if (
      bounds.x + bounds.width < viewLeft ||
      bounds.x > viewRight ||
      bounds.y + bounds.height < viewTop ||
      bounds.y > viewBottom
    ) {
      continue
    }

    canvas.save()
    canvas.concat(geometry.screenMatrix(node, r))
    const rect = r.ck.LTRBRect(0, 0, node.width, node.height)
    canvas.drawRect(rect, r.auxFill)
    canvas.drawRect(rect, r.auxStroke)
    canvas.restore()
  }
}
