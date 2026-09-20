// Тестовые связанные библиотеки на сервер: «Тест: Иконки» и «Тест: Кнопки» (кнопка содержит иконку).
import * as lib from '/opt/open-pencil/packages/core/dist/library/index.js'
import * as sg from '/opt/open-pencil/packages/scene-graph/dist/index.js'

const BASE = 'https://html.norka.cc/api'

async function upload(key, body) {
  const response = await fetch(`${BASE}/objects?key=${encodeURIComponent(key)}`, { method: 'PUT', body })
  if (!response.ok) throw new Error(`upload ${key}: ${response.status}`)
}

async function publish(revision) {
  const m = revision.manifest
  const json = JSON.stringify(lib.encodeLibraryValue(lib.serializeLibraryRevision(revision)))
  await upload(`open-pencil/libraries/${m.libraryId}/revisions/${m.revisionId}.json`, json)
  await upload(
    `open-pencil/libraries/${m.libraryId}/manifest.json`,
    JSON.stringify({
      schemaVersion: 1,
      summary: {
        libraryId: m.libraryId,
        name: m.name,
        latestRevisionId: m.revisionId,
        publishedAt: m.publishedAt,
        assetCount: m.assets.length
      }
    })
  )
  console.log(`✓ ${m.name}: ${m.assets.length} ассет(ов), ревизия ${m.revisionId.slice(0, 10)}`)
}

// Библиотека «Иконки»: компонент icon-wine
const g1 = new sg.SceneGraph()
const p1 = g1.getPages()[0].id
for (let i = 0; i < 30; i += 1) g1.createNode('RECTANGLE', p1, { name: `warmup-${i}`, x: -1000, y: -1000 })
const icon = g1.createNode('COMPONENT', p1, { name: 'icon-wine', x: 0, y: 0 })
g1.updateNode(icon.id, { width: 24, height: 24 })
const glyph = g1.createNode('ELLIPSE', icon.id, { name: 'glyph', x: 4, y: 4 })
g1.updateNode(glyph.id, { width: 16, height: 16 })
const rev1 = await lib.createLibraryRevision({
  libraryId: 'test-icons',
  name: 'Тест: Иконки',
  graph: g1,
  assetNodeIds: [icon.id]
})

// Библиотека «Кнопки»: компонент button, внутри — инстанс иконки из test-icons
const g2 = new sg.SceneGraph()
const p2 = g2.getPages()[0].id
for (let i = 0; i < 30; i += 1) g2.createNode('RECTANGLE', p2, { name: `warmup-${i}`, x: -1000, y: -1000 })
const matIcon = await lib.materializeLibraryAsset(g2, rev1, rev1.manifest.assets[0].key)
const button = g2.createNode('COMPONENT', p2, { name: 'button-primary', x: 200, y: 0 })
g2.updateNode(button.id, { width: 120, height: 40 })
const buttonBg = g2.createNode('RECTANGLE', button.id, { name: 'bg', x: 0, y: 0 })
g2.updateNode(buttonBg.id, { width: 120, height: 40 })
const inst = g2.createInstance(matIcon.componentId, button.id)
g2.updateNode(inst.id, { x: 8, y: 8 })
const label = g2.createNode('TEXT', button.id, { name: 'label', x: 40, y: 12 })
g2.updateNode(label.id, { characters: 'Кнопка', fontSize: 14 })

const rev2 = await lib.createLibraryRevision({
  libraryId: 'test-buttons',
  name: 'Тест: Кнопки',
  graph: g2,
  assetNodeIds: [button.id]
})

await publish(rev1)
await publish(rev2)
console.log('готово')
