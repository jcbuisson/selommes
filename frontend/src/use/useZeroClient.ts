import { Zero } from '@rocicorp/zero'
import { mutators } from '../zero/mutators'
import { schema } from '../zero/schema'

let zero: Zero<typeof schema, typeof mutators> | null = null

export default function useZeroClient() {
   if (!zero) {
      zero = new Zero({
         cacheURL: import.meta.env.VITE_ZERO_CACHE_URL || 'http://localhost:4848',
         schema,
         mutators,
      })
   }
   return { zero }
}
