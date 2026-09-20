<script setup lang="ts">
/**
 * Стартовый экран: таблицы файлов и библиотек с меню действий.
 *
 * Файлы: новый, открыть, переименовать, удалить.
 * Библиотеки: создать, открыть, переименовать, опубликовать / снять с публикации,
 * назначить подключаемой по умолчанию, удалить.
 */
import { useLocalStorage } from '@vueuse/core'
import { computed, onMounted, ref } from 'vue'

import { useI18n } from '@open-pencil/vue'

import {
  defaultLibraryId,
  openLibraryAsFile,
  openPublishLibraryDialog,
  useLibraryService
} from '@/app/libraries'
import { activeStorageProviderID, type StorageDocument } from '@/app/integrations/storage'
import { createActiveStorageAdapter } from '@/app/integrations/storage/runtime'
import { createStorageWorkspaceSource } from '@/app/storage/workspace/source'
import { openStorageDocumentInNewTab } from '@/app/tabs'
import { useDocumentWorkspace } from '@open-pencil/vue'

import { openFileFromPath } from '@/app/shell/menu/use'
import { recentFiles, type RecentDocument } from '@/app/recent-files'
import HomeSearchActions from './search/HomeSearchActions.vue'
import type { RowAction } from './EntityTable.vue'
import EntityTable from './EntityTable.vue'

const emit = defineEmits<{ 'new-document': [] }>()

const { files, common } = useI18n()
const libraryService = useLibraryService()
const storage = useDocumentWorkspace<StorageDocument>({
  source: createStorageWorkspaceSource(() => {}),
  refreshOnFocus: false,
  refreshOnReconnect: true,
  previewConcurrency: 6
})

const documents = storage.documents
const libraries = computed(() => libraryService.summaries.value)

// Разделы: «Файлы» (недавние, потом все на сервере) и «Библиотеки».
const activeSection = useLocalStorage<'files' | 'libraries'>(
  'open-pencil:home-section',
  'files'
)
const query = ref('')

function matches(name: string): boolean {
  const needle = query.value.trim().toLowerCase()
  return needle.length === 0 || name.toLowerCase().includes(needle)
}

const visibleDocuments = computed(() => documents.value.filter((item) => matches(item.name)))

// «Недавние» — то, что открывали в этом браузере. Показываем первыми.
const recents = useDocumentWorkspace<RecentDocument>({
  source: { async refresh() { return recentFiles.value }, loadPreview: () => Promise.resolve(null) },
  refreshOnFocus: false
})
const visibleRecents = computed(() => recents.documents.value.filter((item) => matches(item.name)))

const sections = computed(() => [
  { value: 'files' as const, label: files.value.filesTitle },
  { value: 'libraries' as const, label: files.value.libraries }
])

const recentRows = computed(() =>
  visibleRecents.value.map((document) => ({
    id: document.id,
    cells: [document.name, formattedDate(document.updatedAt)]
  }))
)

function openRecentFile(id: string) {
  void openFileFromPath(id)
}

function openServerFile(id: string) {
  const document = documents.value.find((item) => item.id === id)
  if (document) void openStorageDocumentInNewTab(document)
}
const visibleLibraries = computed(() => libraries.value.filter((item) => matches(item.name)))


onMounted(() => {
  void storage.refresh()
  void libraryService.listLibraries()
})

async function rename(id: string, currentName: string) {
  const name = window.prompt(common.value.rename, currentName)
  if (!name || name === currentName) return
  await createActiveStorageAdapter(activeStorageProviderID.value).renameDocument?.(id, name)
  await storage.refresh()
}

async function removeDocument(id: string) {
  await createActiveStorageAdapter(activeStorageProviderID.value).deleteDocument(id)
  await storage.refresh()
}

const fileRows = computed(() =>
  visibleDocuments.value.map((document) => ({
    id: document.id,
    cells: [document.name, formattedDate(document.updatedAt)]
  }))
)

function fileActions(rowId: string): RowAction[] {
  const document = documents.value.find((item) => item.id === rowId)
  return [
    {
      id: 'open',
      label: common.value.open,
      onSelect: () => document && void openStorageDocumentInNewTab(document)
    },
    {
      id: 'rename',
      label: common.value.rename,
      onSelect: () => document && rename(document.id, document.name)
    },
    {
      id: 'delete',
      label: common.value.delete,
      danger: true,
      separatorBefore: true,
      onSelect: () => void removeDocument(rowId)
    }
  ]
}

const libraryRows = computed(() =>
  visibleLibraries.value.map((library) => ({
    id: library.libraryId,
    cells: [
      library.name,
      files.value.libraryAssetCount({ count: library.assetCount }),
      library.libraryId === defaultLibraryId.value ? files.value.defaultLibrary : ''
    ]
  }))
)

function libraryActions(rowId: string): RowAction[] {
  const library = libraries.value.find((item) => item.libraryId === rowId)
  if (!library) return []
  return [
    {
      id: 'open',
      label: common.value.open,
      onSelect: () => void openLibraryAsFile(rowId)
    },
    {
      id: 'rename',
      label: common.value.rename,
      onSelect: () => rename(rowId, library.name)
    },
    {
      id: 'default',
      label: files.value.setDefaultLibrary,
      separatorBefore: true,
      disabled: defaultLibraryId.value === rowId,
      onSelect: () => {
        defaultLibraryId.value = rowId
      }
    },
    {
      id: 'unpublish',
      label: files.value.unpublishLibrary,
      separatorBefore: true,
      onSelect: () => void unpublishLibrary(rowId)
    },
    {
      id: 'delete',
      label: common.value.delete,
      danger: true,
      onSelect: () => void libraryService.removeLibrary(rowId)
    }
  ]
}

/**
 * Снятие с публикации: библиотека пропадает из списка опубликованных и больше
 * не предлагается для подключения. Локальная копия остаётся — можно вернуть.
 */
async function unpublishLibrary(libraryId: string) {
  await libraryService.removeLibrary(libraryId)
  await libraryService.listLibraries()
}

function formattedDate(updatedAt: string): string {
  const date = new Date(updatedAt)
  return date.getTime() === 0 ? '' : date.toLocaleString()
}
</script>

<template>
  <main class="flex min-h-0 flex-1 flex-col overflow-y-auto bg-app text-surface">
    <section
      class="mx-auto flex w-full max-w-7xl flex-col px-4 py-4 sm:px-6 sm:py-5"
      data-test-id="files-home"
    >
      <HomeSearchActions v-model="query" @new-document="emit('new-document')" />

      <div class="mt-4 mb-6 flex items-center gap-1 border-b border-border" role="tablist">
        <button
          v-for="section in sections"
          :key="section.value"
          type="button"
          role="tab"
          :aria-selected="activeSection === section.value"
          :data-test-id="`home-section-${section.value}`"
          class="relative px-3 py-2 text-xs text-muted hover:text-surface aria-selected:font-semibold aria-selected:text-surface after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:rounded-full after:bg-transparent aria-selected:after:bg-accent"
          @click="activeSection = section.value"
        >
          {{ section.label }}
        </button>
      </div>

      <template v-if="activeSection === 'files'">
        <div class="mb-3 flex items-center justify-between gap-3">
          <h2 class="text-base font-semibold">{{ files.recentFiles }}</h2>
          <AppButton color="neutral" size="sm" @click="emit('new-document')">
            <icon-lucide-plus class="size-3.5" />
            {{ files.newFile }}
          </AppButton>
        </div>
        <p
          v-if="visibleRecents.length === 0"
          class="mb-7 rounded-lg border border-dashed border-border px-4 py-4 text-center text-xs text-muted"
        >
          {{ files.noRecentFilesDescription }}
        </p>
        <EntityTable
          v-else
          class="mb-7"
          :columns="[files.columnName, files.columnUpdated]"
          :rows="recentRows"
          :actions="fileActions"
          :menu-label="common.actions"
          @open="openRecentFile"
        />

        <h2 class="mb-3 text-base font-semibold">{{ files.filesTitle }}</h2>
        <p
          v-if="visibleDocuments.length === 0"
          class="rounded-lg border border-dashed border-border px-4 py-4 text-center text-xs text-muted"
        >
          {{ files.noFilesDescription }}
        </p>
        <EntityTable
          v-else
          :columns="[files.columnName, files.columnUpdated]"
          :rows="fileRows"
          :actions="fileActions"
          :menu-label="common.actions"
          @open="openServerFile"
        />
      </template>

      <template v-else>
        <div class="mb-3 flex items-center justify-between gap-3">
          <h2 class="text-base font-semibold">{{ files.libraries }}</h2>
          <AppButton color="neutral" size="sm" @click="openPublishLibraryDialog()">
            <icon-lucide-plus class="size-3.5" />
            {{ files.createLibrary }}
          </AppButton>
        </div>
        <EntityTable
          v-if="libraryRows.length"
          :columns="[files.columnName, files.libraryAssets, files.libraryStatus]"
          :rows="libraryRows"
          :actions="libraryActions"
          :menu-label="common.actions"
          @open="openLibraryAsFile"
        />
        <p
          v-else
          class="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted"
        >
          {{ files.noLibrariesHint }}
        </p>
      </template>
    </section>
  </main>
</template>
