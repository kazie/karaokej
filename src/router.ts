import { createRouter, createWebHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/remote' },
    { path: '/remote', component: () => import('./views/RemoteView.vue') },
    { path: '/screen', component: () => import('./views/ScreenView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/remote' },
  ],
})
