<script setup lang="ts">
import { computed, ref } from 'vue'

import { useI18n } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import { useLibraryService } from '@/app/libraries/service'
import AppCombobox from '@/components/ui/select/AppCombobox.vue'

import ComponentPreview from './ComponentPreview.vue'

/**
 * «Заменить компонент»: перепривязка выделенных инстансов к другому главному
 * компоненту (аналог Figma «Swap component»). В списке — компоненты документа и
 * компоненты включённых библиотек, с превью и поиском.
 */
const store = useEditorStore()
const libraryService = useLibraryService()
const { panels } = useI18n()
const selected = ref('')
const busy = ref(false)

interface PickerOption {
  value: string
  label: string
  group?: string
  kind: 'document' | 'library'
  nodeId?: string
  libraryId?: string
  revisionId?: string
  assetKey?: string
}

const options = computed<PickerOption[]>(() => {
  const items: PickerOption[] = []
  for (const [id, node] of store.graph.nodes) {
    if (node.type !== 'COMPONENT') continue
    const parent = node.parentId ? store.graph.getNode(node.parentId) : null
    const groupName = parent?.type === 'COMPONENT_SET' ? parent.name : undefined
    items.push({
      value: `doc:${id}`,
      label: groupName ? `${groupName} / ${node.name}` : node.name,
      ...(groupName ? { group: groupName } : {}),
      kind: 'document',
      nodeId: id
    })
  }
  for (const entry of libraryService.enabledAssets.value) {
    items.push({
      value: `lib:${entry.libraryId}:${entry.asset.key}`,
      label: entry.asset.name,
      group: entry.libraryName,
      kind: 'library',
      libraryId: entry.libraryId,
      revisionId: entry.revisionId,
      assetKey: entry.asset.key
    })
  }
  items.sort((a, b) => a.label.localeCompare(b.label))
  return items
})

const previews = computed(() => {
  const map = new Map<
    string,
    { nodeId?: string; libraryId?: string; revisionId?: string; assetKey?: string }
  >()
  for (const option of options.value) {
    map.set(option.value, {
      nodeId: option.nodeId,
      libraryId: option.libraryId,
      revisionId: option.revisionId,
      assetKey: option.assetKey
    })
  }
  return map
})

function previewProps(value: string) {
  return previews.value.get(value) ?? {}
}

async function onSelect(value: string): Promise<void> {
  const option = options.value.find((candidate) => candidate.value === value)
  if (!option) return
  busy.value = true
  try {
    if (option.kind === 'document' && option.nodeId) {
      store.swapComponent(option.nodeId)
    } else if (
      option.kind === 'library' &&
      option.libraryId &&
      option.revisionId &&
      option.assetKey
    ) {
      const result = await libraryService.materialize(
        store,
        option.libraryId,
        option.revisionId,
        option.assetKey
      )
      if (result?.componentId) store.swapComponent(result.componentId)
    }
  } catch (error) {
    console.warn('[Replace component] не удалось заменить компонент:', error)
  } finally {
    busy.value = false
    selected.value = ''
  }
}
</script>

<template>
  <AppCombobox
    :model-value="selected"
    :options="options"
    :placeholder="panels.replaceComponentPlaceholder"
    :search-placeholder="panels.replaceComponentSearch"
    :empty-label="panels.replaceComponentEmpty"
    :disabled="busy"
    :result-limit="80"
    data-test-id="replace-component"
    @update:model-value="onSelect"
  >
    <template #option="{ option }">
      <div class="flex min-w-0 flex-1 items-center gap-2">
        <ComponentPreview v-bind="previewProps(option.value)" />
        <span class="min-w-0 flex-1 truncate">{{ option.label }}</span>
      </div>
    </template>
  </AppCombobox>
</template>
