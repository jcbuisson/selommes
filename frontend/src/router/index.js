
import { createRouter, createWebHistory } from 'vue-router'

import Agenda from '/src/views/Agenda.vue'
import { app } from '/src/client-app.ts'


const routes = [
   {
      path: '/auth',
      component: () => import('/src/views/Auth.vue'),
      meta: {
         requiresConnection: true
      },
   },
   {
      path: '/not-connected',
      component: () => import('/src/views/NotConnected.vue'),
   },
   {
      path: '/agenda',
      component: Agenda,
      meta: {
         requiresAuth: true
      }
   },

   {
      path: "/:catchAll(.*)",
      redirect: '/agenda',
   },
]

const router = createRouter({
   history: createWebHistory(),
   routes
})


router.beforeEach(async (to, from) => {
   console.log('from', from.path, 'to', to.path)

   if (to.meta.requiresConnection && app.isConnected === false/* could be undefined */) {
      return { path: '/not-connected' }
   }

   if (to.meta.requiresAuth) {
      const user_uid = localStorage.getItem('user_uid');
      if (!user_uid) return { path: '/auth'}
   }
})

export default router
