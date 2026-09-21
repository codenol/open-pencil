/**
 * Проверка макета по правилам использованных компонентов.
 *
 * Правила компонента описывают, чего делать нельзя. Здесь ищем нарушения:
 * остался подстановочный маркер, произвольный цвет, растянутая иконка и т.п.
 *
 * Задача — не дать ассистенту отчитаться «всё чисто», когда правила нарушены.
 */
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { resolveRulesTargetForNode } from '#core/tools/component-rules'

export interface RuleViolation {
  severity: 'error' | 'warning'
  component: string
  node: string
  message: string
  /** Пункт правил, который нарушен. */
  rule: string
}

/** Маркеры, которыми в дизайн-системе помечены несделанные замены. */
const PLACEHOLDER_MARKERS = new Set(['wine'])

/**
 * Компоненты-носители: иконка допустима только внутри одного из них.
 * Список по именам компонентов дизайн-системы; сравнение без учёта регистра.
 */
const ICON_CARRIER_NAMES = [
  'button',
  'button-icon-action',
  'input',
  'input search',
  'input password',
  'input number',
  'input datepicker',
  'menuitem',
  'menu button',
  'submenu-item',
  'context-menu-item',
  'chip',
  'badge',
  'endcontent',
  'status indicator_spectr',
  'toggle button',
  'option-switcher'
]

/**
 * Ищет носителя иконки вверх по дереву. Инстанс, компонент или сет с именем
 * из списка носителей. Просто рамка или страница носителем не считается.
 */
function hasIconCarrier(graph: SceneGraph, node: SceneNode): boolean {
  let current = node.parentId ? graph.getNode(node.parentId) : null
  let hops = 0
  while (current && hops < 12) {
    const name = current.name.trim().toLowerCase()
    const isUnit = current.type === 'COMPONENT' || current.type === 'COMPONENT_SET' ||
      current.type === 'INSTANCE'
    if (isUnit && ICON_CARRIER_NAMES.includes(name)) return true
    // Имя варианта вида «State=Default, Type=Filled…» — проверяем по сету.
    if (isUnit && current.parentId) {
      const owner = graph.getNode(current.parentId)
      if (owner?.type === 'COMPONENT_SET') {
        const ownerName = owner.name.trim().toLowerCase()
        if (ICON_CARRIER_NAMES.includes(ownerName)) return true
      }
    }
    current = current.parentId ? graph.getNode(current.parentId) : null
    hops += 1
  }
  return false
}

const ICON_MAX_SIZE = 48

function collectSubtree(graph: SceneGraph, rootIds: string[]): SceneNode[] {
  const out: SceneNode[] = []
  const walk = (id: string, depth: number) => {
    if (depth > 12) return
    const node = graph.getNode(id)
    if (!node) return
    out.push(node)
    for (const childId of node.childIds) walk(childId, depth + 1)
  }
  for (const id of rootIds) walk(id, 0)
  return out
}

/**
 * Ищет нарушения правил в поддереве. Возвращает пустой список, если всё чисто.
 */
export function detectRuleViolations(
  graph: SceneGraph,
  rootIds: string[]
): RuleViolation[] {
  const violations: RuleViolation[] = []
  const nodes = collectSubtree(graph, rootIds)
  /** Компоненты, правила которых уже проверены — чтобы не дублировать. */
  const checked = new Map<string, string>()

  for (const node of nodes) {
    const target = resolveRulesTargetForNode(graph, node.id)
    if (!target) continue
    checked.set(target.componentId, target.name)

    const rules = target.rules
    const forbidden = rules.forbidden ?? []
    const ruleText = (needle: string) =>
      forbidden.find((item) => item.toLowerCase().includes(needle)) ?? ''

    // Подстановочный маркер: свап не сделан.
    if (PLACEHOLDER_MARKERS.has(node.name.trim().toLowerCase())) {
      violations.push({
        severity: 'error',
        component: target.name,
        node: node.name.trim(),
        message: `Остался подстановочный маркер «${node.name.trim()}» — замена не сделана`,
        rule: ruleText('маркер') || 'Оставлять подстановочный маркер нельзя'
      })
      continue
    }

    // Иконка не должна существовать сама по себе: нужен носитель — кнопка,
    // поле, пункт меню, бейдж. Просто «есть родитель» не считается: иконка
    // в углу карточки тоже имеет родителя, но носителем он не является.
    const looksLikeIcon =
      node.name.trim().toLowerCase() === 'icon' ||
      (node.width <= ICON_MAX_SIZE && node.height <= ICON_MAX_SIZE && node.type === 'INSTANCE')
    if (looksLikeIcon && node.type === 'INSTANCE') {
      if (!hasIconCarrier(graph, node)) {
        violations.push({
          severity: 'error',
          component: target.name,
          node: node.name.trim(),
          message: `Иконка «${node.name.trim()}» стоит сама по себе — нужна в составе кнопки, поля, пункта меню или бейджа`,
          rule: ruleText('сам по себе') || 'Иконка не берётся сама по себе'
        })
      }
    }

    // Растянутая иконка: непропорциональные стороны.
    if (looksLikeIcon && node.type === 'INSTANCE' && node.width > 0 && node.height > 0) {
      const ratio = node.width / node.height
      if (ratio > 1.2 || ratio < 0.83) {
        violations.push({
          severity: 'warning',
          component: target.name,
          node: node.name.trim(),
          message: `Иконка «${node.name.trim()}» растянута (${Math.round(node.width)}×${Math.round(node.height)})`,
          rule: ruleText('растягивать') || 'Растягивать нельзя — только размерные варианты'
        })
      }
    }
  }

  return violations
}
