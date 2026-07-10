import { zeroDrizzle } from '@rocicorp/zero/server/adapters/drizzle'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as drizzleSchema from '../db/schema.js'
import { schema } from './schema.js'

const connectionString = process.env.ZERO_UPSTREAM_DB || process.env.DATABASE_URL
if (!connectionString) throw new Error('ZERO_UPSTREAM_DB or DATABASE_URL must be set')

const pool = new Pool({ connectionString })
export const drizzleClient = drizzle(pool, { schema: drizzleSchema })
export const dbProvider = zeroDrizzle(schema, drizzleClient)
