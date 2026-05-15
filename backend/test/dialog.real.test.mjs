// Must be imported before Dexie so it patches globalThis.indexedDB first
import 'fake-indexeddb/auto'

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { io as ioc } from 'socket.io-client'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { pgTable, text, date } from 'drizzle-orm/pg-core'
import { eq } from 'drizzle-orm'

import { createClient, offlinePlugin } from '../../frontend/src/client.mts'
import { expressX } from '#root/src/server.mjs'
import { drizzleOfflinePlugin } from '#root/src/drizzle-plugins.mjs'

const T0 = new Date('2026-01-01T00:00:00Z')
const T1 = new Date('2026-01-02T00:00:00Z')
const T2 = new Date('2026-01-03T00:00:00Z')

let dbCounter = 0

// ─── In-memory DB helper ──────────────────────────────────────────────────────
// Each test gets a fresh PGlite instance with a unique model table so tests
// are fully isolated. Model names use underscores (PG-safe identifiers).

async function createTestDb(modelName) {
   const pglite = new PGlite()
   await pglite.exec(`
      CREATE TABLE metadata (
         uid TEXT PRIMARY KEY,
         created_at DATE,
         updated_at DATE,
         deleted_at DATE
      );
      CREATE TABLE "${modelName}" (
         uid TEXT PRIMARY KEY,
         label TEXT NOT NULL
      );
   `)
   const db = drizzle(pglite)
   const metaTable = pgTable('metadata', {
      uid: text('uid').primaryKey(),
      created_at: date(),
      updated_at: date(),
      deleted_at: date(),
   })
   const modelTable = pgTable(modelName, {
      uid: text('uid').primaryKey(),
      label: text('label').notNull(),
   })
   return { db, metaTable, modelTable }
}

// ─── Test context helper ──────────────────────────────────────────────────────

async function createTestContext(registerServices, { useOfflinePlugin = false } = {}) {
   const serverApp = expressX({})
   registerServices(serverApp)

   await new Promise(resolve => serverApp.httpServer.listen(0, resolve))
   const port = serverApp.httpServer.address().port

   const socket = ioc(`http://localhost:${port}`, {
      transports: ['websocket'],
      autoConnect: false,
   })

   const clientApp = createClient(socket, { debug: false })
   if (useOfflinePlugin) offlinePlugin(clientApp)

   socket.connect()
   await new Promise((resolve, reject) => {
      socket.on('connect', resolve)
      socket.on('connect_error', reject)
   })

   const cleanup = () => new Promise(resolve => {
      socket.disconnect()
      serverApp.httpServer.close(resolve)
   })

   return { clientApp, cleanup }
}

// ─────────────────────────────────────────────────────────────────────────────

describe('Full client ↔ server protocol', () => {

   test('service call is routed through client-request / client-response', async () => {
      const { clientApp, cleanup } = await createTestContext(serverApp => {
         serverApp.createService('greet', {
            hello: async (name) => `Hello, ${name}!`,
         })
      })

      try {
         const result = await clientApp.service('greet').hello('World')
         assert.equal(result, 'Hello, World!')
      } finally {
         await cleanup()
      }
   })

   test('server error is propagated to the client as a rejection', async () => {
      const { clientApp, cleanup } = await createTestContext(serverApp => {
         serverApp.createService('broken', {
            explode: async () => { throw new Error('something went wrong') },
         })
      })

      try {
         await assert.rejects(
            () => clientApp.service('broken').explode(),
            err => {
               assert.match(err.message, /something went wrong/)
               return true
            },
         )
      } finally {
         await cleanup()
      }
   })

   test('sync.go through socket: server records pulled into real Dexie', async () => {
      const modelName = `model${++dbCounter}`
      const { db, metaTable, modelTable } = await createTestDb(modelName)

      await db.insert(modelTable).values({ uid: 'r1', label: 'Vacances' })
      await db.insert(metaTable).values({ uid: 'r1', created_at: '2026-01-01' })

      const { clientApp, cleanup } = await createTestContext(
         serverApp => serverApp.configure(drizzleOfflinePlugin, db, metaTable, [modelTable]),
         { useOfflinePlugin: true },
      )

      try {
         const model = clientApp.createOfflineModel(modelName, ['label'])
         await model.addSynchroWhere({})
         await model.synchronizeAll()

         const r1 = await model.db.values.get('r1')
         assert.ok(r1, 'Dexie should contain the record pulled from server via socket')
         assert.equal(r1.label, 'Vacances')
      } finally {
         await cleanup()
      }
   })

   test('sync.go through socket: local Dexie record pushed to server', async () => {
      const modelName = `model${++dbCounter}`
      const { db, metaTable, modelTable } = await createTestDb(modelName)

      const { clientApp, cleanup } = await createTestContext(
         serverApp => serverApp.configure(drizzleOfflinePlugin, db, metaTable, [modelTable]),
         { useOfflinePlugin: true },
      )

      try {
         const model = clientApp.createOfflineModel(modelName, ['label'])
         await model.db.values.add({ uid: 'x1', label: 'Formation' })
         await model.db.metadata.add({ uid: 'x1', created_at: T1 })
         await model.addSynchroWhere({})
         await model.synchronizeAll()

         const rows = await db.select().from(modelTable).where(eq(modelTable.uid, 'x1'))
         assert.ok(rows.length > 0, 'server should have received the pushed record')
         assert.equal(rows[0].label, 'Formation')
      } finally {
         await cleanup()
      }
   })

   test('record only on client, deleted → ignored on both sides', async () => {
      const modelName = `model${++dbCounter}`
      const { db, metaTable, modelTable } = await createTestDb(modelName)

      const { clientApp, cleanup } = await createTestContext(
         serverApp => serverApp.configure(drizzleOfflinePlugin, db, metaTable, [modelTable]),
         { useOfflinePlugin: true },
      )

      try {
         const model = clientApp.createOfflineModel(modelName, ['label'])
         await model.db.values.add({ uid: 'd1', label: 'Gone', __deleted__: true })
         await model.db.metadata.add({ uid: 'd1', created_at: T0, deleted_at: T1 })
         await model.addSynchroWhere({})
         await model.synchronizeAll()

         const rows = await db.select().from(modelTable)
         assert.ok(!rows.find(r => r.uid === 'd1'), 'server should not have the deleted-only record')
         const d1 = await model.db.values.get('d1')
         assert.ok(!d1, 'Dexie should no longer hold the deleted record')
      } finally {
         await cleanup()
      }
   })

   test('record in both, client newer → server is updated via socket', async () => {
      const modelName = `model${++dbCounter}`
      const { db, metaTable, modelTable } = await createTestDb(modelName)

      await db.insert(modelTable).values({ uid: 'u1', label: 'old' })
      await db.insert(metaTable).values({ uid: 'u1', created_at: '2026-01-01', updated_at: '2026-01-02' })

      const { clientApp, cleanup } = await createTestContext(
         serverApp => serverApp.configure(drizzleOfflinePlugin, db, metaTable, [modelTable]),
         { useOfflinePlugin: true },
      )

      try {
         const model = clientApp.createOfflineModel(modelName, ['label'])
         await model.db.values.add({ uid: 'u1', label: 'new' })
         await model.db.metadata.add({ uid: 'u1', created_at: T0, updated_at: T2 })
         await model.addSynchroWhere({})
         await model.synchronizeAll()

         const rows = await db.select().from(modelTable).where(eq(modelTable.uid, 'u1'))
         assert.equal(rows[0].label, 'new', 'server should have the updated label')
         const clientValue = await model.db.values.get('u1')
         assert.equal(clientValue.label, 'new', 'client Dexie should be unchanged')
      } finally {
         await cleanup()
      }
   })

})
