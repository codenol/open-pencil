// Проверка: теряется ли componentId при клонировании компонента с инстансом
import { readFile } from 'node:fs/promises'
import * as lib from '/opt/open-pencil/packages/core/dist/library/index.js'
import * as sg from '/opt/open-pencil/packages/scene-graph/dist/index.js'

const CATALOG = '/opt/open-pencil/data/site-library-catalog-archive'
const manifest = JSON.parse(await readFile(`${CATALOG}/skala-icons/manifest.json`, 'utf8'))
const stored = lib.decodeLibraryValue(
  JSON.parse(
    await readFile(`${CATALOG}/skala-icons/revisions/${manifest.summary.latestRevisionId}.json`, 'utf8')
  )
)
const revision = lib.deserializeLibraryRevision(stored)

const graph = new sg.SceneGraph()
const pageId = graph.getPages()[0].id

// 1) вставка иконки из библиотеки
const materialized = lib.materializeLibraryAsset(graph, revision, revision.manifest.assets[0].key)
console.log('материализован компонент:', materialized.componentId)

// 2) компонент-контейнер «icon» с инстансом внутри
const comp = graph.createNode('COMPONENT', pageId, { name: 'icon/Size=10' })
const inst = graph.createInstance(materialized.componentId, comp.id)
console.log('инстанс:', inst?.id, 'componentId =', inst?.componentId ?? 'null')

// 3) клонируем компонент (как «Add variant» / дублирование)
const clone = graph.cloneTree(comp.id, pageId, { x: comp.x + comp.width + 40 })
console.log('клон:', clone?.id)
const cloneInst = clone
  ? [...graph.nodes.values()].find((n) => n.parentId === clone.id && n.type === 'INSTANCE')
  : null
console.log('инстанс в клоне:', cloneInst?.id, 'componentId =', cloneInst?.componentId ?? 'NULL')

// 4) копирование инстанса напрямую (cloneTree на инстансе)
const instClone = graph.cloneTree(inst.id, comp.id, { x: 200 })
console.log('клон инстанса:', instClone?.id, 'componentId =', instClone?.componentId ?? 'NULL')
