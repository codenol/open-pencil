import { createRouter, createWebHistory } from 'vue-router'

import WorkspaceView from './views/WorkspaceView.vue'

/**
 * URL-схема (как в Figma):
 *  - `/files` — список файлов;
 *  - `/file/<fileId>` — конкретный файл;
 *  - `/file/<fileId>/<pageSlug>` — страница внутри файла (имя страницы, а не id);
 *  - `/lib/<libraryId>/<pageSlug>` — библиотека (в адресе видно, что это библиотека).
 * Все три маршрута ведут в один воркспейс, состояние которого синхронизируется
 * с адресом (см. `@/app/url/sync`).
 */
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: WorkspaceView },
    { path: '/files', component: WorkspaceView },
    { path: '/file/:fileId/:pageSlug?', component: WorkspaceView },
    { path: '/lib/:libraryId/:pageSlug?', component: WorkspaceView, meta: { library: true } },
    { path: '/storage', redirect: '/' },
    { path: '/demo', component: WorkspaceView, meta: { demo: true } },
    { path: '/share/:roomId', component: WorkspaceView }
  ]
})

export default router
