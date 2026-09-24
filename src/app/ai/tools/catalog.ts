import { ALL_TOOLS, CORE_TOOLS, isToolExposed, toolChangesDocument } from '@open-pencil/core/tools'

import type { ToolAccessEntry } from '@/app/automation/tool-access/types'

/**
 * Что включено у ассистента из коробки.
 *
 * Компактный набор, а не ограничение доступности: остальное можно включить
 * в разделе доступа к инструментам. Но инструменты, без которых сборка ломается
 * молча, обязаны быть здесь — иначе ассистент читает правило про fill_slot,
 * сообщает «this session has no fill_slot tool» и делает блок не тем способом.
 */
const defaultNames = new Set([
  ...CORE_TOOLS.map((tool) => tool.name),
  'get_components',
  'list_libraries',
  'insert_library_component',
  // Сборка из компонентов: без этих слот не пометить, не заполнить и компонент не подменить.
  'mark_slot',
  'fill_slot',
  'swap_component',
  'swap_component_size',
  'list_icons',
  'get_default_variant'
])

export const aiToolDefinitions = ALL_TOOLS.filter((tool) => isToolExposed(tool, 'ai'))

export const configurableAITools: ToolAccessEntry[] = aiToolDefinitions.map((tool) => ({
  name: tool.name,
  description: tool.description,
  effect: toolChangesDocument(tool) ? 'write' : 'read'
}))

export function isAIToolEnabled(name: string, overrides: Readonly<Record<string, boolean>>) {
  return overrides[name] ?? defaultNames.has(name)
}

export function enabledAIToolDefinitions(overrides: Readonly<Record<string, boolean>>) {
  return aiToolDefinitions.filter((tool) => isAIToolEnabled(tool.name, overrides))
}
