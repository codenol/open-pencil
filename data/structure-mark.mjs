// Отметка пройденного уровня в реестре ds-structure.json.
// Использование: bun data/structure-mark.mjs <номер уровня>
// Проверяет, что все зависимости отмечены снизу, ставит статус marked.
import { readFile, writeFile } from 'node:fs/promises'

const FILE = '/opt/open-pencil/data/ds-structure.json'
const level = Number(process.argv[2] ?? '1')
if (!Number.isFinite(level) || level < 1) {
  console.error('укажи номер уровня: bun data/structure-mark.mjs 1')
  process.exit(1)
}

const data = JSON.parse(await readFile(FILE, 'utf8'))
const entities = data.entities ?? data.components
const byId = new Map(entities.map((entity) => [entity.id, entity]))

const current = entities.filter((entity) => entity.level === level)
if (current.length === 0) {
  console.error(`на уровне ${level} нет компонентов`)
  process.exit(1)
}

// Проверка: всё, из чего собран компонент, должно быть отмечено (уровни ниже)
const problems = []
for (const entity of current) {
  for (const depId of entity.deps) {
    const dep = byId.get(depId)
    if (!dep) continue
    if (dep.level >= level) continue // ссылки на равных/выше — циклы/вопросы, отдельно
    if (dep.status !== 'marked') problems.push(`${entity.name} → ${dep.name} (уровень ${dep.level}, ${dep.status})`)
  }
}
if (problems.length > 0) {
  console.log(`не всё снизу отмечено (${problems.length}):`)
  for (const problem of problems.slice(0, 10)) console.log('  ' + problem)
  console.log('сначала отметь предыдущие уровни')
  process.exit(1)
}

const now = new Date().toISOString()
let marked = 0
for (const entity of current) {
  if (entity.status === 'marked') continue
  entity.status = 'marked'
  entity.checkedAt = now
  marked += 1
}

// прогресс
data.progress = {}
for (const entity of entities) {
  const key = String(entity.level)
  data.progress[key] ??= { level: entity.level, name: data.levelNames[String(entity.level)] ?? `уровень ${entity.level}`, total: 0, marked: 0 }
  data.progress[key].total += 1
  if (entity.status === 'marked') data.progress[key].marked += 1
}
data.updatedAt = now

await writeFile(FILE, JSON.stringify(data, null, 1))
console.log(`уровень ${level}: отмечено ${marked} компонентов (всего на уровне ${current.length})`)
console.log('прогресс:')
for (const key of Object.keys(data.progress).sort((a, b) => Number(a) - Number(b))) {
  const p = data.progress[key]
  console.log(`  уровень ${p.level} (${p.name}): ${p.marked}/${p.total}`)
}
