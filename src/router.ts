import { createRouter, createWebHistory } from 'vue-router'

import WorkspaceView from './views/WorkspaceView.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: WorkspaceView },
    // Список файлов — единственный адрес, куда ведёт закреплённый таб «Файлы».
    { path: '/files', component: WorkspaceView },
    // Старые адреса ведут на список файлов.
    { path: '/storage', redirect: '/files' },
    { path: '/demo', component: WorkspaceView, meta: { demo: true } },
    { path: '/share/:roomId', component: WorkspaceView }
  ]
})

export default router
