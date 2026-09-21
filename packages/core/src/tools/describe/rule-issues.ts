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

    // Иконка не должна существовать сама по себе.
    const looksLikeIcon =
      node.name.trim().toLowerCase() === 'icon' ||
      (node.width <= ICON_MAX_SIZE && node.height <= ICON_MAX_SIZE && node.type === 'INSTANCE')
    if (looksLikeIcon && node.type === 'INSTANCE') {
      const parent = node.parentId ? graph.getNode(node.parentId) : null
      const insideComponent =
        parent && (parent.type === 'COMPONENT' || parent.type === 'COMPONENT_SET')
      if (!parent || (!insideComponent && parent.type !== 'FRAME')) {
        violations.push({
          severity: 'warning',
          component: target.name,
          node: node.name.trim(),
          message: `Иконка «${node.name.trim()}» стоит сама по себе — нужна в составе кнопки, поля или пункта меню`,
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
