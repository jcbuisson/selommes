import { readonly, ref } from 'vue'
import { mutators } from '../zero/mutators'
import { queries } from '../zero/queries'

const ranges = ref<any[]>([])
let initialized = false

export default function useRange(zero: any) {
   if (!initialized) {
      initialized = true
      const view = zero.materialize(queries.range.all())
      ranges.value = [...view.data]
      view.addListener((data: any[]) => { ranges.value = [...data] })
   }

   return {
      ranges: readonly(ranges),
      create: async (data: any) => {
         const row = { uid: crypto.randomUUID(), ...data }
         await zero.mutate(mutators.range.create(row)).client
         return row
      },
      update: async (uid: string, data: any) => zero.mutate(mutators.range.update({ uid, ...data })).client,
      remove: async (uid: string) => zero.mutate(mutators.range.remove({ uid })).client,
   }
}
