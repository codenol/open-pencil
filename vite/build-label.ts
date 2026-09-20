import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const COUNTER_FILE = resolve(__dirname, '.build-number')

function readCounter(): number {
  try {
    if (!existsSync(COUNTER_FILE)) return 0
    const value = Number.parseInt(readFileSync(COUNTER_FILE, 'utf8').trim(), 10)
    return Number.isFinite(value) ? value : 0
  } catch {
    return 0
  }
}

function formatMoscowTime(date: Date): string {
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00'
  return `${get('day')}.${get('month')}.${get('year')} ${get('hour')}:${get('minute')} МСК`
}

/**
 * Метка сборки для заголовка окна: номер (инкремент при каждой сборке) и дата-время.
 * В dev-режиме номер не увеличивается, берётся последний записанный.
 */
export function buildLabel(command: 'build' | 'serve'): string {
  const counter = command === 'build' ? readCounter() + 1 : readCounter()
  if (command === 'build') {
    try {
      writeFileSync(COUNTER_FILE, `${counter}\n`)
    } catch {
      // счётчик не критичен
    }
  }
  return `сборка ${counter} · ${formatMoscowTime(new Date())}`
}
