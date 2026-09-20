// Воспроизведение: materializeLibraryAsset из ревизии каталога
import { readFile } from 'node:fs/promises'

const lib = await import('/opt/open-pencil/packages/core/dist/library/index.js')
const sg = await import('/opt/open-pencil/packages/scene-graph/dist/index.js')

const CATALOG = '/opt/open-pencil/data/library-catalog'
const libraryId = process.argv[2] ?? 'skala-icons'
const assetKey = process.argv[3] ?? '60:2117'

const manifest = JSON.parse(await readFile(`${CATALOG}/${libraryId}/manifest.json`, 'utf8'))
const revisionId = manifest.summary.latestRevisionId
const stored = lib.decodeLibraryValue(
  JSON.parse(await readFile(`${CATALOG}/${libraryId}/revisions/${revisionId}.json`, 'utf8'))
)
console.error(`ревизия: ${revisionId}`)
const revision = lib.deserializeLibraryRevision(stored)
console.error(`ассетов: ${revision.manifest.assets.length}`)

const asset = revision.manifest.assets.find((item) => item.key === assetKey)
console.error(`ассет найден: ${asset ? asset.name + ' (' + asset.type + ')' : 'НЕТ'}`)

const graph = new sg.SceneGraph()
try {
  const result = lib.materializeLibraryAsset(graph, revision, assetKey)
  console.error('materialize OK:', JSON.stringify(result))
  console.log(JSON.stringify({ ok: true, result }))
} catch (error) {
  console.error('materialize FAILED:', error?.message)
  console.error(error?.stack?.split('\n').slice(0, 12).join('\n'))
  console.log(JSON.stringify({ ok: false, error: error?.message }))
}
