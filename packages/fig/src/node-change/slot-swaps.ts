/**
 * Сериализация свопа слота на другой компонент.
 *
 * Задача, из которой это выросло: пользователь выделяет слот, просит положить
 * туда блок; ассистент собирает блок компонентом и должен поставить его в слот.
 * Положить инстанс блока внутрь инстанса рабочего экрана нельзя: дети инстанса
 * в файл не пишутся, и работа пропадает при первом сохранении. Проверено:
 * новый узел в инстансе не выживает, а компонент рядом — выживает.
 *
 * В Figma для этого есть своп: переопределение узла внутри мастера по guidPath,
 * где ссылка указывает на другой компонент. Это не новый узел, а замена
 * существующего — поэтому она переживает сохранение.
 *
 * Слот приходит как INSTANCE: сначала он указывал на компонент-заполнитель,
 * после свопа — на компонент блока. Разницу и записываем.
 */

import type { GUID } from '@open-pencil/scene-graph/primitives'

/**
 * Что нужно, чтобы дописать свопы.
 *
 * Узкий контракт вместо полного контекста сериализации: функции нужен только
 * доступ к графу и к карте выданных GUID.
 */
export interface SlotSwapContext {
  graph: {
    getNode: (id: string) => { id: string; type: string; name: string; componentId?: string | null } | undefined
    getChildren: (id: string) => { id: string; type: string; name: string; componentId?: string | null }[]
  }
  nodeIdToGuid?: Map<string, GUID>
  resolveComponentId: (id: string) => string
}

/** Переопределение в формате файла. */
interface SwapOverride {
  guidPath?: { guids?: GUID[] }
  componentId?: string
  [key: string]: unknown
}

function pathKey(guids: GUID[]): string {
  return guids.map(({ sessionID, localID }) => `${sessionID}:${localID}`).join('/')
}

/** Какие узлы мастера уже свопнуты — чтобы не дублировать записи. */
function readExistingSwaps(overrides: SwapOverride[]): Set<string> {
  const done = new Set<string>()
  for (const override of overrides) {
    const guids = override.guidPath?.guids
    if (!guids?.length) continue
    if (typeof override.componentId !== 'string' || !override.componentId) continue
    done.add(pathKey(guids))
  }
  return done
}

/**
 * Дописывает свопы слотов мастера в переопределения инстанса.
 *
 * Путь ведёт к узлу мастера, `componentId` — на компонент, который в этот слот
 * поставили. Возвращает число дописанных свопов.
 */
export function appendSlotSwaps(
  context: SlotSwapContext,
  instanceId: string,
  symbolOverrides: SwapOverride[]
): number {
  const instance = context.graph.getNode(instanceId)
  if (!instance || instance.type !== 'INSTANCE') return 0

  const mainComponentId = context.resolveComponentId(instance.componentId)
  const children = context.graph.getChildren(mainComponentId)
  if (children.length === 0) return 0

  const existing = readExistingSwaps(symbolOverrides)
  let added = 0

  for (const child of children) {
    // Интересны только узлы-инстансы: слот — это инстанс заполнителя.
    if (child.type !== 'INSTANCE') continue

    const guid = context.nodeIdToGuid?.get(child.id)
    if (!guid) continue
    const key = pathKey([guid])
    if (existing.has(key)) continue

    // Компонент самого слота и то, на что он указывает, — это и есть своп:
    // слот мастера смотрит на заполнитель, а в файле он должен смотреть на блок.
    const own = child.componentId
    if (!own) continue
    const resolved = context.resolveComponentId(own)
    if (!resolved || resolved === own) continue

    symbolOverrides.push({
      guidPath: { guids: [guid] },
      componentId: resolved
    })
    existing.add(key)
    added++
  }

  return added
}
