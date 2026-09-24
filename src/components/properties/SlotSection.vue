<script setup lang="ts">
import { computed } from 'vue'

import {
  clearSlotContent,
  ensureSlotProperty,
  getSlotContentId,
  getSlotPropertyInfo,
  releaseOriginalFigArchive,
  removeSlotProperty,
  swapSlotContent
} from '@open-pencil/core/tools'
import { useI18n, useSceneComputed, useSelectionState } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import { useActionToast } from '@/app/shell/toast/action'
import PanelFieldGroup from '@/components/ui/panel/PanelFieldGroup.vue'
import PanelSection from '@/components/ui/panel/PanelSection.vue'
import AppSelect from '@/components/ui/select/AppSelect.vue'
import AppSwitch from '@/components/ui/toggle/AppSwitch.vue'

/**
 * Слот: пометка места под блок и выбор наполнителя — как в Figma.
 *
 * Пометку (переключатель SLOT) можно ставить только в мастер-компоненте —
 * она заводит настоящее свойство типа SLOT у компонента-владельца
 * (ensureSlotProperty), и розовым место подсвечивается тоже только в мастере.
 * Наполнение (swap) меняется только у копии слота внутри инстанса: ссылка на
 * компонент-наполнитель пишется в assignment этого инстанса, мастер и другие
 * инстансы не меняются. Ту же механику использует ассистент.
 */
const store = useEditorStore()
const { panels } = useI18n()
const { selectedNode: node } = useSelectionState()
const { showActionToast } = useActionToast()

/** Где лежит узел: в мастере, в инстансе или на странице. */
function scopeOf(nodeId: string): 'master' | 'instance' | 'page' {
  let current = store.graph.getNode(nodeId)
  if (current?.type === 'INSTANCE') return 'instance'
  while (current?.parentId) {
    const parent = store.graph.getNode(current.parentId)
    if (!parent) break
    if (parent.type === 'INSTANCE') return 'instance'
    if (parent.type === 'COMPONENT' || parent.type === 'COMPONENT_SET') return 'master'
    current = parent
  }
  return 'page'
}

const scope = useSceneComputed(() => (node.value ? scopeOf(node.value.id) : 'page'))

/** Пометку ставят элементам в мастере; наполнение — копиям в инстансах. */
const canMark = computed(() => {
  const type = node.value?.type
  return scope.value === 'master' && (type === 'FRAME' || type === 'COMPONENT')
})

const info = useSceneComputed(() =>
  node.value ? getSlotPropertyInfo(store.graph, node.value.id) : null
)

const canSwap = computed(() => scope.value === 'instance' && info.value !== null)

const visible = computed(() => canMark.value || canSwap.value)

/** Страница узла — для подписи компонента в списке. */
function pageNameOf(nodeId: string): string {
  let current = store.graph.getNode(nodeId)
  while (current) {
    if (current.type === 'CANVAS') return current.name
    current = current.parentId ? store.graph.getNode(current.parentId) : undefined
  }
  return ''
}

const EMPTY_VALUE = '__empty__'

const componentOptions = useSceneComputed(() => {
  const options: Array<{ value: string; label: string }> = [
    { value: EMPTY_VALUE, label: panels.value.slotEmpty }
  ]
  const internalPages = new Set(
    store.graph
      .getPages(true)
      .filter((page) => page.internalOnly)
      .map((page) => page.id)
  )
  for (const candidate of store.graph.getAllNodes()) {
    if (candidate.type !== 'COMPONENT' && candidate.type !== 'COMPONENT_SET') continue
    // Варианты внутри сета не показываем: выбирают сет или обычный компонент.
    const parent = candidate.parentId ? store.graph.getNode(candidate.parentId) : undefined
    if (parent?.type === 'COMPONENT_SET') continue
    if (parent && internalPages.has(parent.id)) continue
    const page = pageNameOf(candidate.id)
    options.push({
      value: candidate.id,
      label: page ? `${page} / ${candidate.name}` : candidate.name
    })
  }
  return options
})

const currentContent = useSceneComputed(() => {
  const n = node.value
  if (!n || !info.value) return EMPTY_VALUE
  const assigned = getSlotContentId(store.graph, n)
  if (!assigned) return EMPTY_VALUE
  // Назначен вариант сета — в селекте показываем сам сет.
  const assignedNode = store.graph.getNode(assigned)
  const parent = assignedNode?.parentId ? store.graph.getNode(assignedNode.parentId) : undefined
  return parent?.type === 'COMPONENT_SET' ? parent.id : assigned
})

/** Мутация с undo-снимком страницы и сбросом исходного архива файла. */
async function mutate(label: string, fn: () => void): Promise<boolean> {
  const before = store.snapshotPage()
  try {
    await store.runMutationWithLayout(fn, store.state.currentPageId)
  } catch {
    return false
  }
  // Правки в графе делают исходный архив негодным — иначе экспорт вернёт
  // старый файл, и пометка/наполнение не сохранятся.
  releaseOriginalFigArchive(store.graph)
  const after = store.snapshotPage()
  store.pushUndoEntry({
    label,
    forward: () => store.restorePageFromSnapshot(after),
    inverse: () => store.restorePageFromSnapshot(before)
  })
  store.requestRender()
  return true
}

const slotModel = computed<boolean>({
  get: () => info.value !== null,
  set: (value) => {
    void toggleSlot(value)
  }
})

async function toggleSlot(value: boolean): Promise<void> {
  const n = node.value
  if (!n) return
  if (!value) {
    await mutate('Slot: off', () => {
      removeSlotProperty(store.graph, n.id)
    })
    return
  }
  const ok = await mutate('Slot: on', () => {
    if (!ensureSlotProperty(store.graph, n.id)) throw new Error('no component owner')
  })
  if (!ok) showActionToast(panels.value.slotNeedsComponent)
}

const contentModel = computed<string>({
  get: () => currentContent.value,
  set: (value) => {
    void swapContent(value)
  }
})

async function swapContent(value: string): Promise<void> {
  const n = node.value
  if (!n || !info.value) return
  await mutate('Slot content', () => {
    const current = store.graph.getNode(n.id)
    if (!current) throw new Error('node gone')
    const result =
      value === EMPTY_VALUE
        ? clearSlotContent(store.graph, current)
        : swapSlotContent(store.graph, current, value)
    if ('error' in result) throw new Error(result.error)
  })
}
</script>

<template>
  <PanelSection v-if="visible" :label="panels.slot">
    <template v-if="canMark" #actions>
      <AppSwitch v-model="slotModel" :label="panels.slot" />
    </template>
    <PanelFieldGroup v-if="canSwap" :label="panels.slotContent">
      <AppSelect
        v-model="contentModel"
        :label="panels.slotContent"
        :options="componentOptions"
        data-property="slot-content"
      />
    </PanelFieldGroup>
  </PanelSection>
</template>
