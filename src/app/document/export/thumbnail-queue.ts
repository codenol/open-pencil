/**
 * Очередь рендера превью ассетов.
 *
 * Каждое превью — отдельный рендер в PNG через CanvasKit. Если запускать их
 * все сразу (ассетов бывают сотни), они конкурируют за один рендерер: превью
 * появляются по одному и очень медленно. Здесь ограничиваем число
 * одновременных рендеров.
 */
const MAX_CONCURRENT = 3

let active = 0
const waiting: Array<() => void> = []

function release(): void {
  active -= 1
  const next = waiting.shift()
  if (next) next()
}

export function withThumbnailSlot<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      active += 1
      task()
        .then(resolve, reject)
        .finally(release)
    }
    if (active < MAX_CONCURRENT) run()
    else waiting.push(run)
  })
}
