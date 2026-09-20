<script setup lang="ts">
/**
 * Таблица файлов с меню действий у каждой строки.
 *
 * Карточки не подходят, когда действий много: открыть, переименовать,
 * удалить, для библиотек — опубликовать/снять с публикации, назначить
 * подключаемой по умолчанию.
 */
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from 'reka-ui'
import type { Component } from 'vue'

export interface RowAction {
  id: string
  label: string
  icon?: Component
  danger?: boolean
  separatorBefore?: boolean
  disabled?: boolean
  onSelect?: () => void
}

defineProps<{
  columns: string[]
  rows: Array<{ id: string; cells: string[]; meta?: string }>
  actions: (rowId: string) => RowAction[]
  menuLabel?: string
}>()

const emit = defineEmits<{ open: [id: string] }>()
</script>

<template>
  <div class="overflow-hidden rounded-lg border border-border" data-test-id="entity-table">
    <table class="w-full border-collapse text-left text-xs">
      <thead>
        <tr class="border-b border-border bg-panel-field/40">
          <th
            v-for="column in columns"
            :key="column"
            class="px-3 py-2 font-medium text-muted"
          >
            {{ column }}
          </th>
          <th class="w-10 px-3 py-2" />
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="row.id"
          class="border-b border-border last:border-b-0 hover:bg-hover"
          :data-test-id="`entity-row-${row.id}`"
        >
          <td
            v-for="(cell, index) in row.cells"
            :key="index"
            class="cursor-pointer px-3 py-2 align-middle"
            :class="index === 0 ? 'font-medium text-surface' : 'text-muted'"
            @click="emit('open', row.id)"
          >
            {{ cell }}
          </td>
          <td class="px-2 py-1 text-right">
            <DropdownMenuRoot>
              <DropdownMenuTrigger
                class="rounded p-1 text-muted hover:bg-hover hover:text-surface"
                :aria-label="menuLabel"
                :data-test-id="`entity-menu-${row.id}`"
              >
                <icon-lucide-more-vertical class="size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuPortal>
                <DropdownMenuContent
                  class="z-50 min-w-44 rounded-md border border-border bg-panel p-1 text-xs shadow-lg"
                  :side-offset="4"
                  align="end"
                >
                  <template v-for="action in actions(row.id)" :key="action.id">
                    <DropdownMenuSeparator
                      v-if="action.separatorBefore"
                      class="my-1 h-px bg-border"
                    />
                    <DropdownMenuItem
                      :disabled="action.disabled"
                      :data-test-id="`entity-action-${action.id}`"
                      class="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none data-[disabled]:cursor-default data-[disabled]:opacity-40 data-[highlighted]:bg-hover"
                      :class="action.danger ? 'text-danger' : 'text-surface'"
                      @select="action.onSelect?.()"
                    >
                      <component :is="action.icon" v-if="action.icon" class="size-3.5" />
                      {{ action.label }}
                    </DropdownMenuItem>
                  </template>
                </DropdownMenuContent>
              </DropdownMenuPortal>
            </DropdownMenuRoot>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
