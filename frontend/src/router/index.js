
import { createRouter, createWebHistory } from 'vue-router'

import Agenda from '/src/views/Agenda.vue'


const routes = [
   {
      path: '/auth',
      component: () => import('/src/views/Auth.vue'),
   },
   {
      path: '/agenda',
      component: Agenda,
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


router.beforeEach(async (to, from, next) => {
   console.log('from', from.path, 'to', to.path)

   if (to.meta.requiresAuth) {
   }

   next()
})

export default router
