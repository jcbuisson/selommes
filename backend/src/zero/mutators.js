import { defineMutator, defineMutators } from '@rocicorp/zero'
import { z } from 'zod'

const userRow = z.object({ uid: z.uuid(), email: z.email(), name: z.string().min(1), color: z.string().min(1) })
const rangeRow = z.object({
   uid: z.uuid(), user_uid: z.uuid(), start: z.string(), end: z.string(), label: z.string().min(1), color: z.string().min(1),
})

export const mutators = defineMutators({
   user: {
      create: defineMutator(userRow, async ({ tx, args }) => tx.mutate.user.insert(args)),
      update: defineMutator(userRow, async ({ tx, args }) => tx.mutate.user.update(args)),
      remove: defineMutator(z.object({ uid: z.uuid() }), async ({ tx, args }) => tx.mutate.user.delete(args)),
   },
   range: {
      create: defineMutator(rangeRow, async ({ tx, args }) => tx.mutate.range.insert(args)),
      update: defineMutator(rangeRow, async ({ tx, args }) => tx.mutate.range.update(args)),
      remove: defineMutator(z.object({ uid: z.uuid() }), async ({ tx, args }) => tx.mutate.range.delete(args)),
   },
})
