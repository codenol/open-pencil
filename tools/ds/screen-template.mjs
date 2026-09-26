// Разбор эталона экрана — в правила кадра.
//
// Эталон отвечает не на вопрос «как собрать деталь», а на вопрос «как собрать
// экран этого типа»: из каких зон он состоит, какие поля данных куда ложатся,
// какие места чем заполнены и что в нём менять нельзя. Разбор лежит в
// pluginData кадра и едет с ним.
//
// Статику (правила и словарь «смысл → вариант») держим здесь — это контракт
// эталона. Строение (колонки, ряды, места и блоки) снимаем с самой сборки:
// иначе описание расходится с картинкой.
//
// Запуск: bun tools/ds/screen-template.mjs <вход.fig> <выход.fig>
import { readFile, writeFile } from 'node:fs/promises'

import * as corePkg from '@open-pencil/core'
import { exportFigFile } from '@open-pencil/core/io'
import { releaseFigPopulationWorker } from '@open-pencil/core/kiwi'
import {
  releaseOriginalFigArchive,
  resolveScreenTemplate,
  writeScreenTemplate
} from '@open-pencil/core/tools'
import * as figPkg from '@open-pencil/fig'

const [input, output] = process.argv.slice(2)
if (!input || !output) {
  console.error('нужно: bun tools/ds/screen-template.mjs <вход.fig> <выход.fig>')
  process.exit(1)
}

const PAGE_NAME = 'Эталоны'
const FRAME_PREFIX = 'Эталон · '

/**
 * Контракт данных эталона: колонка → поле записи и вид ячейки.
 * Порядок колонок — как на экране.
 */
const COLUMNS = [
  { index: 1, field: 'check', kind: 'check' },
  { index: 2, field: 'version', kind: 'text' },
  { index: 3, field: 'type', kind: 'text' },
  { index: 4, field: 'model', kind: 'text' },
  { index: 5, field: 'value', kind: 'badge' },
  { index: 6, field: 'node', kind: 'text' },
  { index: 7, field: 'nodeModel', kind: 'text' },
  { index: 8, field: 'module', kind: 'text' },
  { index: 9, field: 'status', kind: 'status' },
  { index: 10, kind: 'empty' }
]

/**
 * Смысл → вариант: состояние берут смыслом, цвет приходит с вариантом.
 * Значения варианта записаны точно, чтобы наполнение ставило их свопом,
 * а не подбирало на глаз.
 */
const STATUS_BASE = { component: '✅status', values: { Content: 'text-only', Size: 'Ladge', Outline: 'no' } }
const STATUSES = [
  { sense: 'хорошо', variant: { ...STATUS_BASE, values: { ...STATUS_BASE.values, Severity: 'success' } } },
  { sense: 'предупреждение', variant: { ...STATUS_BASE, values: { ...STATUS_BASE.values, Severity: 'degradation' } } },
  { sense: 'оранжевое предупреждение', variant: { ...STATUS_BASE, values: { ...STATUS_BASE.values, Severity: 'warning' } } },
  { sense: 'ошибка', variant: { ...STATUS_BASE, values: { ...STATUS_BASE.values, Severity: 'critical' } } },
  { sense: 'нет данных', variant: { ...STATUS_BASE, values: { ...STATUS_BASE.values, Severity: 'stop' } } },
  { sense: 'в работе', variant: { ...STATUS_BASE, values: { ...STATUS_BASE.values, Severity: 'additional' } } },
  { sense: 'новое', variant: { ...STATUS_BASE, values: { ...STATUS_BASE.values, Severity: 'new' } } },
  {
    sense: 'выбрано',
    variant: { component: 'Checkbox', values: { State: 'Default', Checked: 'Yes', Text: 'No' } }
  },
  {
    sense: 'выбрано частично',
    variant: { component: 'Checkbox', values: { State: 'Default', Checked: 'Indeterminate', Text: 'No' } }
  },
  {
    sense: 'не выбрано',
    variant: { component: 'Checkbox', values: { State: 'Default', Checked: 'No', Text: 'No' } }
  }
]

const BADGES = [
  { sense: 'нейтрально', variant: { component: 'badge', values: { Color: 'gray', Content: 'Text only' } } },
  { sense: 'внимание', variant: { component: 'badge', values: { Color: 'yellow', Content: 'Text only' } } },
  { sense: 'ошибка', variant: { component: 'badge', values: { Color: 'rose', Content: 'Text only' } } },
  { sense: 'служебное', variant: { component: 'badge', values: { Color: 'violet', Content: 'Text only' } } },
  { sense: 'норма', variant: { component: 'badge', values: { Color: 'green', Content: 'Text only' } } },
  {
    sense: 'информация',
    variant: { component: 'badge', values: { Color: 'cornflower-blue', Content: 'Text only' } }
  }
]

const TEMPLATE = {
  purpose: 'Список однотипных записей о железе и прошивках с фильтрами сверху и статусом у каждой записи.',
  use: [
    'Записей больше десятка и поля у них одинаковые.',
    'Сверху нужны отбор, поиск и переключение вида, а у записи — метка состояния.',
    'Данные ложатся в фиксированные колонки.'
  ],
  avoid: [
    'Записей одна-две — таблица тяжелее простого списка.',
    'Нужна иерархия, группировки и раскрывающиеся уровни.',
    'Полей больше пятнадцати или они разные у разных записей.',
    'Выдача карточками с картинками.'
  ],
  zones: [
    'Каркас: сайдбар 249 (рейл 48 + меню 200) и контент-панель, зазор 8, отступ 8, фон layout/background/default.',
    'Шапка экрана: заголовок, табы, строка фильтров, паддинг 16, зазоры 12.',
    'Таблица: шапка 52, ряды 44, между рядами Divider.'
  ],
  allowed: [
    'Подписи и данные, число рядов.',
    'Смысл состояния у записи и категорию бейджа.',
    'Заголовок экрана, подписи колонок и табов.',
    'Ширины колонок, если данных объективно больше, чем в эталоне.'
  ],
  forbidden: [
    'Менять каркас, порядок зон и отступы.',
    'Заменять компоненты и их варианты: ячейку — фреймом, кнопку — прямоугольником, статус — цветным текстом.',
    'Красить произвольным цветом вместо токена.',
    'Подделывать состояние прозрачностью или подкраской.',
    'Оставлять пару «шапка + ячейка» разной ширины.',
    'Рисовать узлы внутрь инстанса: они видны на канвасе, но в файл не пишутся.',
    'Оставлять заготовки: «Text», «VALUE», «Column Name», «Расположение», «Input», «Button», «STATUS», «с».'
  ],
  checks: [
    'Все подписи заполнены, заготовок нет.',
    'Число ячеек в ряду равно числу колонок; ширины шапки и ячеек совпадают.',
    'Состояния и метки взяты вариантами наборов, цвета и отступы — токенами.',
    'Рядов столько, сколько данных; пустых колонок нет.',
    'Активный таб один; активный пункт меню соответствует экрану и совпадает с заголовком.'
  ],
  issues: [
    'Колонка «Версия ПО» в эталоне пустая — образец с пустой колонкой копировать нельзя.',
    'Логотип «Геном 2.0» показывает только «2.0»: внутри мастера инстанс logo-genom-b остался без мастера.',
    'Подсветки ряда по состоянию в ДС нет, хотя на референсе ряды тонированы.',
    'У ✅status нет варианта «текст + обводка»: Outline=yes бывает только у пустого статуса.',
    'Компонента строки в ДС нет: строка собирается фреймом и разделителем.',
    'У menuitem нет двухстрочного варианта.',
    'Заливки бейджей и статусов заданы литералами, а не токенами — в тёмной теме не переключатся.'
  ],
  statuses: STATUSES,
  badges: BADGES,
  layout: {
    title: 'Заголовок',
    headerRow: 'Шапка таблицы',
    rowPattern: 'Строка N',
    cellPattern: 'Ячейка N.M',
    separator: 'Разделитель N'
  }
}

// ── Документ ──────────────────────────────────────────────────────────────

const bytes = new Uint8Array(await readFile(input))
const parsed = figPkg.parseFigBuffer(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
)
const graph = corePkg.importNodeChanges(parsed.nodeChanges, parsed.blobs, new Map(parsed.images), {
  populate: 'all'
})
const kids = (node) => (node?.childIds ?? []).map((id) => graph.getNode(id)).filter(Boolean)
const findDeep = (node, predicate) => {
  for (const child of kids(node)) {
    if (predicate(child)) return child
    const deep = findDeep(child, predicate)
    if (deep) return deep
  }
  return null
}
const textOf = (node) => {
  const text = node ? findDeep(node, (child) => child.type === 'TEXT') : null
  return text ? String(text.text) : ''
}

const page = graph.getPages().find((item) => item.name.trim() === PAGE_NAME)
if (!page) throw new Error(`нет страницы «${PAGE_NAME}»`)
const frame = kids(page).find((item) => item.name.trim().startsWith(FRAME_PREFIX))
if (!frame) throw new Error(`нет кадра «${FRAME_PREFIX}…» на странице «${PAGE_NAME}»`)

const table = findDeep(frame, (child) => child.name.trim() === 'Таблица')
const header = kids(table).find((child) => child.name.trim() === 'Шапка таблицы')
const sampleRow = kids(table).find((child) => child.name.trim() === 'Строка 1')
if (!header || !sampleRow) throw new Error('в эталоне нет шапки таблицы или первого ряда')

const columns = COLUMNS.map((column) => {
  const headerCell = kids(header).find((child) => child.name.trim() === `Шапка ${column.index}`)
  const sampleCell = kids(sampleRow).find(
    (child) => child.name.trim() === `Ячейка 1.${column.index}`
  )
  const columnSpec = {
    index: column.index,
    title: textOf(headerCell),
    width: sampleCell ? Math.round(sampleCell.width) : 0,
    kind: column.kind
  }
  if (column.field) columnSpec.field = column.field
  return columnSpec
})

/** Места сайдбара: имя свойства, id и блок, которым место заполнено. */
function collectSlots() {
  const sidebar = kids(frame).find((child) => child.name.trim() === 'Сайдбар')
  if (!sidebar) return []
  const owner = kids(sidebar).length ? sidebar : null
  const declared = new Map()
  const master = sidebar.componentId ? graph.getNode(sidebar.componentId) : null
  const set = master?.parentId ? graph.getNode(master.parentId) : null
  for (const definition of set?.componentPropertyDefinitions ?? []) {
    if (definition.type === 'SLOT') declared.set(definition.id, definition.name)
  }
  const slots = []
  const walk = (node) => {
    for (const ref of node.componentPropertyReferences ?? []) {
      if (ref.field !== 'SLOT') continue
      const filled = kids(node)[0]
      const block = filled?.componentId ? graph.getNode(filled.componentId) : null
      slots.push({
        name: declared.get(ref.propertyId) ?? node.name.trim(),
        propertyId: ref.propertyId,
        blockId: filled?.componentId ?? '',
        blockName: block?.name.trim() ?? ''
      })
    }
    kids(node).forEach(walk)
  }
  if (owner) walk(owner)
  return slots
}

const slots = collectSlots()
const template = { ...TEMPLATE, columns, slots }
writeScreenTemplate(graph, frame.id, template)

// ── Проверка: разбор читается и сходится со сборкой ───────────────────────

const resolved = resolveScreenTemplate(graph, frame.id)
console.log(`эталон: ${frame.name.trim()} (${Math.round(frame.width)}x${Math.round(frame.height)})`)
console.log(`колонки: ${resolved.columns.map((c) => `${c.index}. ${c.title}${c.field ? ` → ${c.field}` : ''}`).join(' | ')}`)
console.log(`словарь: статусов ${TEMPLATE.statuses.length} (со значениями вариантов: ${TEMPLATE.statuses.filter((item) => typeof item.variant === 'object').length}), бейджей ${TEMPLATE.badges.length}`)
console.log(`ряды: ${resolved.rows.length}; места: ${slots.map((s) => `${s.name} → ${s.blockName}`).join(', ')}`)
const empty = resolved.columns.filter((column) => column.kind === 'text' && !column.field)
if (empty.length) console.log(`внимание: без поля остались колонки ${empty.map((c) => c.index).join(', ')}`)

releaseOriginalFigArchive(graph)
releaseFigPopulationWorker(graph)
const exported = await exportFigFile(graph, undefined, undefined, undefined, false, {
  noImplicitInternalCanvas: true
})
await writeFile(
  output,
  Buffer.from(exported.buffer.slice(exported.byteOffset, exported.byteOffset + exported.byteLength))
)
console.log(`записано: ${output} (${Math.round(exported.byteLength / 1024)} КБ)`)
