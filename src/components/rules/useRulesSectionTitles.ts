import { computed } from 'vue'

import { useI18n } from '@open-pencil/vue'

import type { RulesSection } from '@/app/libraries/component-rules'

/** Подпись строкой: часть ключей перевода типизирована функцией подстановки. */
export function rulesLabel(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * Заголовки разделов правил на текущем языке — одной картой, чтобы панель и
 * редактор называли разделы одинаково.
 */
export function useRulesSectionTitles() {
  const { panels } = useI18n()
  return computed<Record<RulesSection, string>>(() => ({
    purpose: rulesLabel(panels.value.rulesPurpose),
    howto: rulesLabel(panels.value.rulesHowto),
    use: rulesLabel(panels.value.rulesUse),
    avoid: rulesLabel(panels.value.rulesAvoid),
    allowed: rulesLabel(panels.value.rulesAllowed),
    forbidden: rulesLabel(panels.value.rulesForbidden),
    checks: rulesLabel(panels.value.rulesChecks)
  }))
}
