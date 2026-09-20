<script setup lang="ts">
/**
 * Стартовый экран: таблицы файлов и библиотек с меню действий.
 *
 * Файлы: новый, открыть, переименовать, удалить.
 * Библиотеки: создать, открыть, переименовать, опубликовать / снять с публикации,
 * назначить подключаемой по умолчанию, удалить.
 */
import { computed, onMounted } from 'vue'

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
  documents.value.map((document) => ({
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
  libraries.value.map((library) => ({
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
      class="mx-auto flex w-full max-w-7xl flex-col gap-7 px-4 py-5 sm:px-6"
      data-test-id="files-home"
    >
      <div class="flex items-center justify-between gap-3">
        <h1 class="text-base font-semibold">{{ files.filesTitle }}</h1>
        <div class="flex items-center gap-2">
          <AppButton color="neutral" size="sm" @click="emit('new-document')">
            <icon-lucide-plus class="size-3.5" />
            {{ files.newFile }}
          </AppButton>
          <AppButton color="neutral" size="sm" @click="openPublishLibraryDialog()">
            <icon-lucide-plus class="size-3.5" />
            {{ files.createLibrary }}
          </AppButton>
        </div>
      </div>

      <p
        v-if="documents.length === 0"
        class="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted"
      >
        {{ files.noFilesDescription }}
      </p>
      <EntityTable
        v-else
        :columns="[files.columnName, files.columnUpdated]"
        :rows="fileRows"
        :actions="fileActions"
        :menu-label="common.actions"
        @open="(id) => {
          const document = documents.find((item) => item.id === id)
          if (document) void openStorageDocumentInNewTab(document)
        }"
      />

      <div class="flex items-center justify-between gap-3">
        <h2 class="text-base font-semibold">{{ files.libraries }}</h2>
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
    </section>
  </main>
</template>
