import { readonly, ref } from 'vue'
import { mutators } from '../zero/mutators'
import { queries } from '../zero/queries'

const users = ref<any[]>([])
let initialized = false

export default function useUser(zero: any) {
   if (!initialized) {
      initialized = true
      const view = zero.materialize(queries.user.all())
      users.value = [...view.data]
      view.addListener((data: any[]) => { users.value = [...data] })
   }

   return {
      users: readonly(users),
      findByUID: async (uid: string) => (await zero.run(queries.user.byUID({ uid })))[0] ?? null,
      findByEmail: async (email: string) => (await zero.run(queries.user.byEmail({ email })))[0] ?? null,
      create: async (data: any) => {
         const row = { uid: crypto.randomUUID(), ...data }
         await zero.mutate(mutators.user.create(row)).client
         return row
      },
      update: async (uid: string, data: any) => zero.mutate(mutators.user.update({ uid, ...data })).client,
      remove: async (uid: string) => zero.mutate(mutators.user.remove({ uid })).client,
   }
}
