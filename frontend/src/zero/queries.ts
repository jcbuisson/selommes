import { defineQueries, defineQuery } from '@rocicorp/zero'
import { z } from 'zod'
import { zql } from './schema'

export const queries = defineQueries({
   user: {
      all: defineQuery(() => zql.user),
      byUID: defineQuery(z.object({ uid: z.string() }), ({ args }) => zql.user.where('uid', args.uid)),
      byEmail: defineQuery(z.object({ email: z.string() }), ({ args }) => zql.user.where('email', args.email)),
   },
   range: {
      all: defineQuery(() => zql.range),
      byUID: defineQuery(z.object({ uid: z.string() }), ({ args }) => zql.range.where('uid', args.uid)),
   },
})
