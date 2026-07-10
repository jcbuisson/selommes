import { createBuilder, createSchema, string, table } from '@rocicorp/zero'

const user = table('user')
   .columns({ uid: string(), email: string(), name: string(), color: string() })
   .primaryKey('uid')

const range = table('range')
   .columns({
      uid: string(), user_uid: string().optional(), start: string(), end: string(), label: string(), color: string(),
   })
   .primaryKey('uid')

export const schema = createSchema({ tables: [user, range] })
export const zql = createBuilder(schema)
