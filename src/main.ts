import { createHead } from '@unhead/vue/client'
import { createApp } from 'vue'

import { createRetainedScopePlugin } from '@open-pencil/vue'

import './app.css'
import { preloadFonts } from '@/app/editor/fonts'
import { sanitizeLibraryCatalogSource } from '@/app/libraries/preset'
import { IS_TAURI } from '@/constants'

import App from './App.vue'
import router from './router'

preloadFonts()
sanitizeLibraryCatalogSource()
const head = createHead()
createApp(App).use(router).use(head).use(createRetainedScopePlugin()).mount('#app')

if (!IS_TAURI) {
  void import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({ immediate: true })
    return undefined
  })
}
