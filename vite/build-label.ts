import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Номер и время сборки для заголовка окна.
 *
 * Номер лежит в vite/.build-number и растёт на каждой сборке. Время берётся
 * в момент сборки. Значения подставляются в index.html и в код как define,
 * чтобы строка была доступна и в рантайме.
 */
const here = dirname(fileURLToPath(import.meta.url))
const counterPath = resolve(here, '.build-number')

function nextBuildNumber() {
  let current = 0
  if (existsSync(counterPath)) {
    const raw = Number.parseInt(readFileSync(counterPath, 'utf8').trim(), 10)
    if (Number.isFinite(raw)) current = raw
  }
  const next = current + 1
  mkdirSync(dirname(counterPath), { recursive: true })
  writeFileSync(counterPath, String(next), 'utf8')
  return next
}

function moscowStamp(date = new Date()) {
  // Время сборки в московском времени: сдвиг +3 часа от UTC, круглый год.
  const msk = new Date(date.getTime() + 3 * 60 * 60 * 1000)
  const pad = (value) => String(value).padStart(2, '0')
  const day = `${pad(msk.getUTCDate())}.${pad(msk.getUTCMonth() + 1)}.${msk.getUTCFullYear()}`
  const time = `${pad(msk.getUTCHours())}:${pad(msk.getUTCMinutes())}`
  return { day, time }
}

export function buildLabelPlugin({ number, reuse = false } = {}) {
  const build = reuse && number ? number : nextBuildNumber()
  const { day, time } = moscowStamp()
  const label = `сборка ${build} · ${time} · ${day}`

  return {
    name: 'open-pencil:build-label',
    transformIndexHtml(html) {
      return html.replace(/<title>([^<]*)<\/title>/, `<title>${label}</title>`)
    },
    config() {
      return {
        define: {
          __BUILD_LABEL__: JSON.stringify(label),
          __BUILD_NUMBER__: JSON.stringify(String(build))
        }
      }
    }
  }
}

export default buildLabelPlugin
