// Хранилище файлов OpenPencil для сервера норки.
//
// Простой HTTP-сервис без зависимостей: файлы документов, метаданные и
// превью. Никакого S3 — только файловая система.
//
// Данные: /var/lib/openpencil-norka/
//   files/<id>.fig        содержимое документа (то, что отдаёт редактор)
//   meta/<id>.json        имя, время изменения
//   thumbs/<id>.png       превью для списка
//
// API:
//   GET    /api/health                     состояние сервиса
//   GET    /api/documents                  список документов
//   GET    /api/documents/<id>             содержимое (.fig)
//   PUT    /api/documents/<id>             сохранить (тело — .fig)
//   DELETE /api/documents/<id>             удалить
//   GET    /api/documents/<id>/metadata    имя и время
//   GET    /api/documents/<id>/thumbnail   превью
//   PUT    /api/documents/<id>/thumbnail   сохранить превью
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile, unlink, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

const PORT = Number(process.env.PORT ?? 7802)
const ROOT = process.env.ROOT ?? '/var/lib/openpencil-norka'
const MAX_BODY = 200 * 1024 * 1024

const DIRS = {
  files: join(ROOT, 'files'),
  meta: join(ROOT, 'meta'),
  thumbs: join(ROOT, 'thumbs')
}

const SAFE_ID = /^[A-Za-z0-9._:-]{1,180}$/

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, PUT, PATCH, DELETE, OPTIONS',
    'access-control-allow-headers': '*',
    ...headers
  })
  res.end(body)
}

function sendJson(res, status, value) {
  send(res, status, JSON.stringify(value), { 'content-type': 'application/json; charset=utf-8' })
}

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw new Error('body too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

async function readMeta(id) {
  try {
    return JSON.parse(await readFile(join(DIRS.meta, `${id}.json`), 'utf8'))
  } catch {
    return null
  }
}

async function writeMeta(id, meta) {
  await writeFile(join(DIRS.meta, `${id}.json`), JSON.stringify(meta), 'utf8')
}

async function fileExists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function listDocuments() {
  let names = []
  try {
    names = await readdir(DIRS.files)
  } catch {
    return []
  }
  const out = []
  for (const name of names) {
    if (!name.endsWith('.fig')) continue
    const id = name.slice(0, -4)
    const info = await stat(join(DIRS.files, name)).catch(() => null)
    const meta = (await readMeta(id)) ?? {}
    out.push({
      id,
      name: meta.name ?? id,
      kind: meta.kind ?? 'design',
      updatedAt: meta.updatedAt ?? info?.mtime?.toISOString() ?? null,
      size: info?.size ?? null,
      hasThumbnail: await fileExists(join(DIRS.thumbs, `${id}.png`))
    })
  }
  out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
  return out
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const path = url.pathname

  if (req.method === 'OPTIONS') return send(res, 204, '')

  try {
    if (path === '/api/health') {
      return sendJson(res, 200, { ok: true, service: 'openpencil-norka-storage' })
    }

    // Список документов
    if (path === '/api/documents' && req.method === 'GET') {
      return sendJson(res, 200, { documents: await listDocuments() })
    }

    const docMatch = path.match(/^\/api\/documents\/([^/]+)$/)
    if (docMatch) {
      const id = decodeURIComponent(docMatch[1])
      if (!SAFE_ID.test(id)) return sendJson(res, 400, { error: 'bad id' })
      const file = join(DIRS.files, `${id}.fig`)

      if (req.method === 'GET') {
        if (!(await fileExists(file))) return sendJson(res, 404, { error: 'not found' })
        const bytes = await readFile(file)
        return send(res, 200, bytes, {
          'content-type': 'application/octet-stream',
          'content-length': String(bytes.length),
          'cache-control': 'no-store'
        })
      }

      if (req.method === 'PUT') {
        const body = await readBody(req)
        if (body.length === 0) return sendJson(res, 400, { error: 'empty body' })
        await writeFile(file, body)
        const name = req.headers['x-document-name']
        const kindHeader = req.headers['x-document-kind']
        const previous = (await readMeta(id)) ?? {}
        // Тип файла: макет или библиотека. Из него строится адрес.
        const kind =
          typeof kindHeader === 'string' && (kindHeader === 'library' || kindHeader === 'design')
            ? kindHeader
            : previous.kind ?? 'design'
        const meta = {
          name: typeof name === 'string' && name ? decodeURIComponent(name) : previous.name ?? id,
          kind,
          updatedAt: new Date().toISOString()
        }
        await writeMeta(id, meta)
        return sendJson(res, 200, { ok: true, id, size: body.length, ...meta })
      }

      if (req.method === 'DELETE') {
        await unlink(file).catch(() => {})
        await unlink(join(DIRS.meta, `${id}.json`)).catch(() => {})
        await unlink(join(DIRS.thumbs, `${id}.png`)).catch(() => {})
        return sendJson(res, 200, { ok: true, id })
      }
    }

    const metaMatch = path.match(/^\/api\/documents\/([^/]+)\/metadata$/)
    if (metaMatch) {
      const id = decodeURIComponent(metaMatch[1])
      if (!SAFE_ID.test(id)) return sendJson(res, 400, { error: 'bad id' })

      if (req.method === 'GET') {
        const meta = await readMeta(id)
        if (!meta) return sendJson(res, 404, { error: 'not found' })
        return sendJson(res, 200, { id, kind: meta.kind ?? 'design', ...meta })
      }

      // Смена типа файла: макет ↔ библиотека. Меняет адрес файла.
      if (req.method === 'PATCH') {
        const raw = await readBody(req)
        let payload = {}
        try {
          payload = JSON.parse(raw.toString('utf8') || '{}')
        } catch {
          return sendJson(res, 400, { error: 'bad json' })
        }
        const meta = (await readMeta(id)) ?? {}
        if (payload.kind === 'library' || payload.kind === 'design') meta.kind = payload.kind
        if (typeof payload.name === 'string' && payload.name) meta.name = payload.name
        meta.updatedAt = new Date().toISOString()
        await writeMeta(id, meta)
        return sendJson(res, 200, { ok: true, id, ...meta })
      }
    }

    const thumbMatch = path.match(/^\/api\/documents\/([^/]+)\/thumbnail$/)
    if (thumbMatch) {
      const id = decodeURIComponent(thumbMatch[1])
      if (!SAFE_ID.test(id)) return sendJson(res, 400, { error: 'bad id' })
      const file = join(DIRS.thumbs, `${id}.png`)
      if (req.method === 'GET') {
        if (!(await fileExists(file))) return sendJson(res, 404, { error: 'not found' })
        const bytes = await readFile(file)
        return send(res, 200, bytes, { 'content-type': 'image/png', 'cache-control': 'no-store' })
      }
      if (req.method === 'PUT') {
        const body = await readBody(req)
        await writeFile(file, body)
        return sendJson(res, 200, { ok: true, id })
      }
    }

    return sendJson(res, 404, { error: 'not found', path })
  } catch (error) {
    console.error('[storage]', error)
    return sendJson(res, 500, { error: String(error?.message ?? error) })
  }
})

for (const dir of Object.values(DIRS)) await mkdir(dir, { recursive: true })

server.listen(PORT, '127.0.0.1', () => {
  console.log(`openpencil storage on http://127.0.0.1:${PORT} (root: ${ROOT})`)
})
