
import { createRouter, createWebHistory } from 'vue-router'

import Agenda from '/src/views/Agenda.vue'


const routes = [
   {
      path: '/auth',
      // name: 'auth',
      component: () => import('/src/views/Auth.vue'),
   },
   {
      path: '/agenda',
      // name: 'agenda',
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

   if (to.meta.requiresAuth) {
      console.log('REQQQQ');
      const user_uid = localStorage.getItem('user_uid');
      if (!user_uid) return { path: '/auth'}
   }
})

export default router
