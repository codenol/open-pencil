/**
 * Карточка возможностей компонента — что с ним можно сделать.
 *
 * Ассистенту перед вставкой нужно не дерево узлов, а выбор: какие бывают
 * виды, размеры, состояния, что можно положить внутрь. У кнопки внутри один
 * текстовый слой — по составу ничего не понять, а по вариантам всё видно:
 * «заливка или контур, шесть цветов, два размера, можно с иконкой».
 *
 * Возможности выводятся из имён вариантов. В дизайн-системе они названы
 * структурно (`Type=Filled, Size=Large`), поэтому разбор даёт готовую картину
 * без обхода дерева и без лишних вызовов.
 */
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

/** Сколько значений показываем на свойство. */
const MAX_VALUES = 8
/** Свойства, которые не помогают выбрать: состояния наведения и прочее. */
const NOISE = /^(state|checked|visible|open|collapsed)$/i

export interface ComponentCapability {
  /** Имя свойства: `Type`, `Size`, `Sentiment`. */
  name: string
  /** Возможные значения в порядке появления. */
  values: string[]
  /** Значений больше, чем поместилось. */
  truncated: boolean
}

export interface ComponentCapabilities {
  /** Свойства и их значения — по ним видно, из чего выбирать. */
  capabilities: ComponentCapability[]
  /** Сколько всего вариантов у сета. */
  variantCount: number
  /** Короткая строка: «Filled/Outline/Ghost · 6 цветов · 2 размера». */
  summary: string
}

/** Разбирает имя варианта `Type=Filled, Size=Large` на пары. */
function parseVariantName(name: string): Array<[string, string]> {
  const pairs: Array<[string, string]> = []
  for (const chunk of name.split(',')) {
    const index = chunk.indexOf('=')
    if (index === -1) continue
    const key = chunk.slice(0, index).trim()
    const value = chunk.slice(index + 1).trim()
    if (key && value) pairs.push([key, value])
  }
  return pairs
}

/**
 * Собирает возможности компонента.
 *
 * Для обычного компонента (не сета) возможностей нет — вернём `null`,
 * чтобы поиск не показывал пустую карточку.
 */
export function describeCapabilities(
  graph: SceneGraph,
  componentId: string
): ComponentCapabilities | null {
  const node = graph.getNode(componentId)
  if (!node) return null

  // Если это вариант внутри сета — работаем с его сетом.
  const parent = node.parentId ? graph.getNode(node.parentId) : null
  const set = node.type === 'COMPONENT_SET' ? node : parent?.type === 'COMPONENT_SET' ? parent : null
  if (!set || set.childIds.length < 2) return null

  const collected = new Map<string, Set<string>>()
  for (const id of set.childIds) {
    const variant = graph.getNode(id)
    if (!variant) continue
    for (const [key, value] of parseVariantName(variant.name)) {
      const bucket = collected.get(key) ?? new Set<string>()
      bucket.add(value)
      collected.set(key, bucket)
    }
  }

  const capabilities: ComponentCapability[] = []
  for (const [name, values] of collected) {
    // Состояния и служебные флаги не помогают выбрать — они задаются сами.
    if (NOISE.test(name)) continue
    const all = [...values]
    capabilities.push({
      name,
      values: all.slice(0, MAX_VALUES),
      truncated: all.length > MAX_VALUES
    })
  }
  if (capabilities.length === 0) return null

  const summary = capabilities
    .map((capability) => {
      const label = capability.truncated
        ? `${capability.values.length}+ знач.`
        : capability.values.join('/')
      return `${capability.name}: ${label}`
    })
    .join(' · ')

  return { capabilities, variantCount: set.childIds.length, summary }
}
