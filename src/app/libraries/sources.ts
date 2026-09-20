/**
 * Связь «библиотека → файл-источник»: при публикации запоминаем, из какого файла
 * библиотека опубликована, чтобы её можно было открыть и поправить (переопубликовать).
 * Хранение — локальное (переживает перезагрузку), ключ файла — его адресный id.
 */
const STORAGE_KEY = 'open-pencil:library-sources'

export interface LibrarySourceRecord {
  fileKey: string
  name: string
}

type LibrarySourceMap = Record<string, LibrarySourceRecord>

function read(): LibrarySourceMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as LibrarySourceMap) : {}
  } catch {
    return {}
  }
}

export function rememberLibrarySource(libraryId: string, fileKey: string, name: string): void {
  const records = read()
  records[libraryId] = { fileKey, name }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
  } catch {
    // приватный режим/полный localStorage — связь просто не сохранится
  }
}

export function librarySource(libraryId: string): LibrarySourceRecord | null {
  return read()[libraryId] ?? null
}
