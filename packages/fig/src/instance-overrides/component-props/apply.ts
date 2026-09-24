import { guidToString } from '@open-pencil/fig/node-change'
import { copyFills, copyStyleRuns } from '@open-pencil/scene-graph/copy'

import { applyOverridePatch, type OverridePatch } from '../patches'
import { getComponentRoot } from '../resolve'
import type { ComponentPropRef, ComponentPropValue, OverrideContext } from '../types'
import { propTextCharacters } from './values'

function applyPatchAndMark(
  ctx: OverrideContext,
  childId: string,
  patch: OverridePatch,
  modified?: Set<string>
): void {
  if (applyOverridePatch(ctx, patch)) modified?.add(childId)
}

function applyVisibleProp(
  ctx: OverrideContext,
  childId: string,
  val: ComponentPropValue,
  modified?: Set<string>
): void {
  if (val.boolValue === undefined) return
  applyPatchAndMark(
    ctx,
    childId,
    { targetId: childId, source: 'component-prop', props: { visible: val.boolValue } },
    modified
  )
}

function applyTextProp(
  ctx: OverrideContext,
  childId: string,
  val: ComponentPropValue,
  modified?: Set<string>
): void {
  const child = ctx.graph.getNode(childId)
  const text = propTextCharacters(val)
  if (text === undefined || child?.type !== 'TEXT') return
  const source = child.componentId ? ctx.graph.getNode(child.componentId) : null
  const props: Parameters<typeof applyPatchAndMark>[2]['props'] = { text }
  if (source?.type === 'TEXT' && source.text === text) {
    props.width = source.width
    props.height = source.height
    props.fills = copyFills(source.fills)
    props.styleRuns = copyStyleRuns(source.styleRuns)
    props.derivedTextGlyphs = source.derivedTextGlyphs
      ? structuredClone(source.derivedTextGlyphs)
      : undefined
  }
  applyPatchAndMark(ctx, childId, { targetId: childId, source: 'component-prop', props }, modified)
}

function applySwapProp(
  ctx: OverrideContext,
  childId: string,
  val: ComponentPropValue,
  modified?: Set<string>
): void {
  const swapId =
    propTextCharacters(val) ?? (val.guidValue ? guidToString(val.guidValue) : undefined)
  const newCompId = swapId ? ctx.guidToNodeId.get(swapId) : undefined
  if (!newCompId) return
  const currentCompId = ctx.graph.getNode(childId)?.componentId
  if (currentCompId && getComponentRoot(ctx, currentCompId) === getComponentRoot(ctx, newCompId)) {
    return
  }
  applyPatchAndMark(
    ctx,
    childId,
    {
      targetId: childId,
      source: 'component-prop',
      swapComponentId: getComponentRoot(ctx, newCompId)
    },
    modified
  )
}

const EMPTY_SLOT_GUID = { sessionID: 4294967295, localID: 4294967295 }

/**
 * Наполнение места (свойство SLOT) в инстансе.
 *
 * Содержимое места живёт не в мастере, а в assignment инстанса: ссылка на
 * компонент-наполнитель. Мастер при этом не меняется — поэтому один и тот же
 * макетный компонент в разных экранах может держать разное содержимое.
 *
 * Копия места внутри инстанса получает наполнитель как инстанс: её прежние
 * (умолчальные) дети убираются, иначе содержимое удвоится.
 */
function applySlotProp(
  ctx: OverrideContext,
  childId: string,
  val: ComponentPropValue,
  modified?: Set<string>
): void {
  const guid = val.slotContentIdValue?.guid
  if (
    !guid ||
    (guid.sessionID === EMPTY_SLOT_GUID.sessionID && guid.localID === EMPTY_SLOT_GUID.localID)
  ) {
    return
  }
  const contentId = ctx.guidToNodeId.get(guidToString(guid))
  if (!contentId) return
  const slot = ctx.graph.getNode(childId)
  const content = ctx.graph.getNode(contentId)
  if (!slot || content?.type !== 'COMPONENT') return

  // Уже наполнен этим компонентом — не трогаем.
  if (
    slot.childIds.length === 1 &&
    ctx.graph.getNode(slot.childIds[0])?.componentId === contentId
  ) {
    return
  }

  for (const existing of [...slot.childIds]) ctx.graph.deleteNode(existing)
  const placed = ctx.graph.createInstance(contentId, childId)
  if (placed) modified?.add(childId)
}

export function applyComponentPropRef(
  ctx: OverrideContext,
  childId: string,
  ref: ComponentPropRef,
  val: ComponentPropValue,
  modified?: Set<string>
): void {
  switch (ref.componentPropNodeField) {
    case 'VISIBLE':
      applyVisibleProp(ctx, childId, val, modified)
      break
    case 'TEXT_DATA':
      applyTextProp(ctx, childId, val, modified)
      break
    case 'OVERRIDDEN_SYMBOL_ID':
      applySwapProp(ctx, childId, val, modified)
      break
    case 'SLOT_CONTENT_ID':
      applySlotProp(ctx, childId, val, modified)
      break
  }
}
