<script setup lang="ts">
import { useElementVisibility } from '@vueuse/core'
import { computed, ref, useTemplateRef, watch } from 'vue'

import { useEditorStore } from '@/app/editor/active-store'

import { documentComponentPreviewUrl, libraryComponentPreviewUrl } from './component-preview'

const props = withDefaults(
  defineProps<{
    nodeId?: string | null
    libraryId?: string | null
    revisionId?: string | null
    assetKey?: string | null
    size?: number
  }>(),
  { size: 20 }
)

const store = useEditorStore()
const url = ref<string | null>(null)
const root = useTemplateRef<HTMLElement>('root')
const isVisible = useElementVisibility(root)
const style = computed(() => ({ width: `${props.size}px`, height: `${props.size}px` }))

watch(
  () => [props.nodeId, props.libraryId, props.revisionId, props.assetKey, isVisible.value],
  async ([nodeId, libraryId, revisionId, assetKey, visible]) => {
    url.value = null
    if (!visible) return
    try {
      if (typeof nodeId === 'string' && nodeId) {
        url.value = await documentComponentPreviewUrl(nodeId, store.graph)
      } else if (
        typeof libraryId === 'string' &&
        libraryId &&
        typeof revisionId === 'string' &&
        revisionId &&
        typeof assetKey === 'string' &&
        assetKey
      ) {
        url.value = await libraryComponentPreviewUrl(libraryId, revisionId, assetKey)
      }
    } catch {
      url.value = null
    }
  },
  { immediate: true, flush: 'post' }
)
</script>

<template>
  <span ref="root" class="shrink-0" :style="style" aria-hidden="true">
    <img
      v-if="url"
      :src="url"
      alt=""
      class="size-full rounded-sm bg-white/5 object-contain"
      loading="lazy"
      draggable="false"
    />
    <span v-else class="block size-full rounded-sm bg-hover" />
  </span>
</template>
