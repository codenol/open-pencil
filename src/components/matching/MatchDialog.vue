<script setup lang="ts">
import { computed, ref } from 'vue'

import { useI18n } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import { notificationMessages } from '@/app/i18n/notifications'
import { useLibraryService } from '@/app/libraries/service'
import { matchDialogOpen } from '@/app/matching/dialog'
import { linkComponentToMaster } from '@/app/matching/link'
import { collectMatchRows, type MatchCandidate, type MatchRow } from '@/app/matching/table'
import { toast } from '@/app/shell/ui'
import ComponentPreview from '@/components/properties/ComponentPreview.vue'
import AppButton from '@/components/ui/button/AppButton.vue'
import { AppDialogBody, AppDialogHeader, AppDialogRoot } from '@/components/ui/dialog'
import AppCombobox from '@/components/ui/select/AppCombobox.vue'

/**
 * «Соответствие»: копии компонентов, приехавшие из других библиотек.
 * Показывает источник и даёт связать копию с мастером — чтобы обновления
 * источника доходили до этого файла.
 */
const store = useEditorStore()
const libraryService = useLibraryService()
const { panels, common } = useI18n()

const filter = ref<'unlinked' | 'all'>('unlinked')
const busy = ref(false)
const linked = ref(new Set<string>())
const limit = 120

const candidates = computed<MatchCandidate[]>(() => {
  const items: MatchCandidate[] = []
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

const rows = computed(() => collectMatchRows(store.graph, candidates.value))

const visibleRows = computed(() => {
  const filtered =
    filter.value === 'all'
      ? rows.value
      : rows.value.filter((row) => !row.linkedLibraryId && !linked.value.has(row.nodeId))
  return filtered.slice(0, limit)
})

const totalUnlinked = computed(
  () => rows.value.filter((row) => !row.linkedLibraryId && !linked.value.has(row.nodeId)).length
)

const previews = computed(() => {
  const map = new Map<
    string,
    { nodeId?: string; libraryId?: string; revisionId?: string; assetKey?: string }
  >()
  for (const option of candidates.value) {
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

async function onPick(row: MatchRow, value: string): Promise<void> {
  const candidate = candidates.value.find((item) => item.value === value)
  if (!candidate) return
  busy.value = true
  try {
    await linkComponentToMaster(store, row, candidate, (libraryId, revisionId, assetKey) =>
      libraryService.materialize(store, libraryId, revisionId, assetKey)
    )
    linked.value = new Set([...linked.value, row.nodeId])
  } catch (error) {
    toast.error(
      notificationMessages.get().operationFailed({
        error: error instanceof Error ? error.message : String(error)
      })
    )
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <AppDialogRoot v-model:open="matchDialogOpen" size="lg" height="tall" data-test-id="match-dialog">
    <AppDialogHeader
      :heading="panels.matchTitle"
      :description="panels.matchDescription"
      :close-label="common.close"
    />
    <AppDialogBody>
      <div class="mb-3 flex flex-wrap items-center gap-2">
        <AppButton
          :variant="filter === 'unlinked' ? 'solid' : 'outline'"
          :color="filter === 'unlinked' ? 'primary' : 'neutral'"
          @click="filter = 'unlinked'"
        >
          {{ panels.matchFilterUnlinked({ count: totalUnlinked }) }}
        </AppButton>
        <AppButton
          :variant="filter === 'all' ? 'solid' : 'outline'"
          :color="filter === 'all' ? 'primary' : 'neutral'"
          @click="filter = 'all'"
        >
          {{ panels.matchFilterAll({ count: rows.length }) }}
        </AppButton>
      </div>

      <div
        v-if="visibleRows.length === 0"
        class="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted"
      >
        {{ filter === 'unlinked' ? panels.matchEmptyUnlinked : panels.matchEmptyAll }}
      </div>

      <div
        v-for="row in visibleRows"
        :key="row.nodeId"
        class="flex items-center gap-3 border-b border-border py-2.5"
        :data-match-row="row.nodeId"
      >
        <icon-lucide-component class="size-4 shrink-0 text-component" />
        <div class="min-w-0 flex-1">
          <p class="truncate text-xs text-surface">
            {{ row.name }}
            <span v-if="row.kind === 'set'" class="text-muted">· {{ panels.matchSet }}</span>
          </p>
          <p class="truncate text-[10px] text-muted">
            {{ panels.matchInstances({ count: row.instances }) }}
            <template v-if="row.sourceLibraryKey">
              · {{ panels.matchSourceExternal }} {{ row.sourceLibraryKey.slice(0, 14) }}…
            </template>
            <template v-else-if="row.publishId">
              · {{ panels.matchSourceOrigin }} {{ row.publishId }}
            </template>
          </p>
        </div>
        <span v-if="row.linkedLibraryId" class="shrink-0 text-[10px] text-success">
          {{ panels.matchLinked }}
        </span>
        <span v-else-if="linked.has(row.nodeId)" class="shrink-0 text-[10px] text-success">
          {{ panels.matchLinked }}
        </span>
        <AppCombobox
          v-else
          :model-value="''"
          :options="candidates"
          :placeholder="panels.matchChooseMaster"
          :search-placeholder="panels.matchSearch"
          :empty-label="panels.matchNoCandidates"
          :disabled="busy"
          :result-limit="60"
          class="w-52 shrink-0"
          @update:model-value="(value: string) => onPick(row, value)"
        >
          <template #option="{ option }">
            <div class="flex min-w-0 flex-1 items-center gap-2">
              <ComponentPreview v-bind="previewProps(option.value)" />
              <span class="min-w-0 flex-1 truncate">{{ option.label }}</span>
            </div>
          </template>
        </AppCombobox>
      </div>

      <p v-if="visibleRows.length === limit" class="pt-3 text-center text-[10px] text-muted">
        {{ panels.matchLimitHint({ limit }) }}
      </p>
    </AppDialogBody>
  </AppDialogRoot>
</template>
