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

   test('record in both, DB newer → client cache is updated with server value', async () => {
      const modelName = `model${++dbCounter}`
      const { db, metaTable, modelTable } = await createTestDb(modelName)

      // Server has s1 at T2 (newer than client)
      await db.insert(modelTable).values({ uid: 's1', label: 'server-v2' })
      await db.insert(metaTable).values({ uid: 's1', created_at: '2026-01-01', updated_at: '2026-01-03' })

      const { clientApp, cleanup } = await createTestContext(
         serverApp => serverApp.configure(drizzleOfflinePlugin, db, metaTable, [modelTable]),
         { useOfflinePlugin: true },
      )

      try {
         const model = clientApp.createOfflineModel(modelName, ['label'])
         // Client has s1 at T1 (stale)
         await model.db.values.add({ uid: 's1', label: 'client-v1' })
         await model.db.metadata.add({ uid: 's1', created_at: T0, updated_at: T1 })
         await model.addSynchroWhere({})
         await model.synchronizeAll()

         const s1 = await model.db.values.get('s1')
         assert.equal(s1.label, 'server-v2', 'client Dexie should be updated with server\'s newer value')

         // A second sync must be a no-op — proves the client timestamp was
         // correctly updated to the server's, avoiding an infinite re-sync loop.
         await model.synchronizeAll()
         const s1Again = await model.db.values.get('s1')
         assert.equal(s1Again.label, 'server-v2', 'second sync should not overwrite client value')
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

   test('record deleted on server while client was offline is re-created on reconnect', async () => {
      const modelName = `model${++dbCounter}`
      const { db, metaTable, modelTable } = await createTestDb(modelName)

      // r1 exists on server initially
      await db.insert(modelTable).values({ uid: 'r1', label: 'original' })
      await db.insert(metaTable).values({ uid: 'r1', created_at: '2026-01-01' })

      // Server-side delete while client was offline: hard-delete from model table,
      // but metadata row stays with deleted_at set (this is what deleteWithMeta does)
      await db.delete(modelTable).where(eq(modelTable.uid, 'r1'))
      await db.update(metaTable).set({ deleted_at: '2026-01-02' }).where(eq(metaTable.uid, 'r1'))

      const { clientApp, cleanup } = await createTestContext(
         serverApp => serverApp.configure(drizzleOfflinePlugin, db, metaTable, [modelTable]),
         { useOfflinePlugin: true },
      )

      try {
         const model = clientApp.createOfflineModel(modelName, ['label'])
         // Client has r1 — it was offline when the server deleted it
         await model.db.values.add({ uid: 'r1', label: 'keep me' })
         await model.db.metadata.add({ uid: 'r1', created_at: T0 })
         await model.addSynchroWhere({})
         await model.synchronizeAll()

         // Client's copy should have been pushed back to the server
         const rows = await db.select().from(modelTable)
         assert.ok(rows.find(r => r.uid === 'r1'), 'server should have r1 after client pushes it back')
         assert.equal(rows.find(r => r.uid === 'r1').label, 'keep me')
         // And client's Dexie should still have it
         const r1 = await model.db.values.get('r1')
         assert.ok(r1, 'client Dexie should still have r1 after sync')
      } finally {
         await cleanup()
      }
   })

   test('offline changes are synced after server restart', async () => {
      const modelName = `model${++dbCounter}`
      const { db, metaTable, modelTable } = await createTestDb(modelName)

      // ─ Phase 1: start server, connect, register synchro scope ─
      const serverApp1 = expressX({})
      serverApp1.configure(drizzleOfflinePlugin, db, metaTable, [modelTable])
      await new Promise(resolve => serverApp1.httpServer.listen(0, resolve))
      const port = serverApp1.httpServer.address().port

      const socket = ioc(`http://localhost:${port}`, {
         transports: ['websocket'],
         autoConnect: false,
         reconnectionDelay: 100,
         reconnectionDelayMax: 500,
      })
      const clientApp = createClient(socket, { debug: false })
      offlinePlugin(clientApp)
      socket.connect()
      await new Promise((resolve, reject) => {
         socket.on('connect', resolve)
         socket.on('connect_error', reject)
      })

      const model = clientApp.createOfflineModel(modelName, ['label'])
      await model.addSynchroWhere({})
      await model.synchronizeAll() // initial sync — server is empty

      // ─ Phase 2: stop server; disconnect all clients ─
      // io.disconnectSockets() gives 'io server disconnect' which suppresses
      // socket.io auto-reconnect, so we reconnect manually in phase 5.
      const disconnected = new Promise(resolve => socket.once('disconnect', resolve))
      serverApp1.io.disconnectSockets(true)
      serverApp1.httpServer.closeAllConnections()
      await new Promise(resolve => serverApp1.httpServer.close(resolve))
      await disconnected

      assert.equal(clientApp.isConnected, false, 'client should be offline')

      // ─ Phase 3: write to Dexie while offline ─
      await model.db.values.add({ uid: 'y1', label: 'Offline change' })
      await model.db.metadata.add({ uid: 'y1', created_at: T1 })

      // ─ Phase 4: restart server on the same port ─
      const serverApp2 = expressX({})
      serverApp2.configure(drizzleOfflinePlugin, db, metaTable, [modelTable])
      await new Promise(resolve => serverApp2.httpServer.listen(port, resolve))

      // ─ Phase 5: reconnect manually (auto-reconnect is suppressed after
      // server-initiated disconnect) and wait for offlinePlugin to fire ─
      const reconnected = new Promise((resolve, reject) => {
         const timer = setTimeout(() => reject(new Error('reconnect timeout')), 5000)
         socket.once('connect', () => { clearTimeout(timer); resolve() })
      })
      socket.connect()
      await reconnected

      // ─ Phase 6: offlinePlugin's connect listener fires synchronizeAll in the
      // background; awaiting it here serialises behind the mutex so assertions
      // run only after the offline change has been pushed to the server. ─
      await model.synchronizeAll()

      // ─ Phase 7: assert ─
      assert.equal(clientApp.isConnected, true, 'client should be online again')
      const rows = await db.select().from(modelTable).where(eq(modelTable.uid, 'y1'))
      assert.ok(rows.length > 0, 'offline change should reach the server after reconnect')
      assert.equal(rows[0].label, 'Offline change')

      socket.disconnect()
      await new Promise(resolve => serverApp2.httpServer.close(resolve))
   })

})
