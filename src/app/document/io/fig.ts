import { readFigFile } from '@open-pencil/core/io/formats/fig'

/**
 * Открытие .fig в браузере.
 *
 * `populate: 'all'` наполняет инстансы на всех страницах. С `first-page`
 * содержимое подтягивалось только для первой страницы, а остальные (Icon,
 * Buttons, …) оставались пустыми — иконки внутри компонентов не рисовались.
 * Файлы дизайн-системы небольшие, поэтому грузим целиком.
 */
export function readFigDocument(file: File, signal?: AbortSignal) {
  return readFigFile(file, {
    populate: 'all',
    signal
  })
}
