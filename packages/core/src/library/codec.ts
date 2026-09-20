import { decodeBase64, encodeBase64 } from '#core/bytes'

/**
 * Кодек тел ревизий библиотек: JSON не умеет Map/Uint8Array, поэтому при записи
 * превращаем Map в маркированные массивы пар, а Uint8Array — в base64-строки.
 * Одинаково применяется и файловым каталогом (CLI), и веб-каталогом, и S3-хранилищем.
 */
const MAP_TAG = 'openpencil/map'
const OBJECT_TAG = 'openpencil/object'

interface EncodedMap {
  $openPencilType: typeof MAP_TAG
  entries: unknown[]
}

function isEncodedMap(value: object): value is EncodedMap {
  return (
    '$openPencilType' in value &&
    (value as { $openPencilType?: unknown }).$openPencilType === MAP_TAG &&
    'entries' in value &&
    Array.isArray((value as { entries?: unknown }).entries)
  )
}

function isMarkerShapedObject(value: object): boolean {
  return '$openPencilType' in value
}

export function encodeLibraryValue(value: unknown): unknown {
  if (value instanceof Map) {
    return {
      $openPencilType: MAP_TAG,
      entries: [...value].map(([key, entry]) => [encodeLibraryValue(key), encodeLibraryValue(entry)])
    }
  }
  if (value instanceof Uint8Array) return { $bytes: encodeBase64(value) }
  if (Array.isArray(value)) return value.map(encodeLibraryValue)
  if (value && typeof value === 'object') {
    const encoded = Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, encodeLibraryValue(entry)])
    )
    return isMarkerShapedObject(value)
      ? { $openPencilType: OBJECT_TAG, value: encoded }
      : encoded
  }
  return value
}

export function decodeLibraryValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeLibraryValue)
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (
      record.$openPencilType === OBJECT_TAG &&
      record.value &&
      typeof record.value === 'object' &&
      !Array.isArray(record.value)
    ) {
      return Object.fromEntries(
        Object.entries(record.value).map(([key, entry]) => [key, decodeLibraryValue(entry)])
      )
    }
    if (isEncodedMap(value)) {
      return new Map(
        (value as EncodedMap).entries.flatMap((entry) =>
          Array.isArray(entry) && entry.length === 2
            ? [[decodeLibraryValue(entry[0]), decodeLibraryValue(entry[1])] as const]
            : []
        )
      )
    }
    if (typeof record.$bytes === 'string') {
      return decodeBase64(record.$bytes)
    }
    return Object.fromEntries(
      Object.entries(record).map(([key, entry]) => [key, decodeLibraryValue(entry)])
    )
  }
  return value
}
