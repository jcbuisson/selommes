// Must be imported before Dexie so it patches globalThis.indexedDB first
import 'fake-indexeddb/auto'

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { io as ioc } from 'socket.io-client'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { eq } from 'drizzle-orm'

import { createClient, offlinePlugin } from '../../frontend/src/client.mts'
// import { expressX } from '@jcbuisson/express-x'
import { expressX } from '#root/src/server.mjs'
// import { drizzleOfflinePlugin } from '@jcbuisson/express-x-drizzle'
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
         created_at TIMESTAMP,
         updated_at TIMESTAMP,
         deleted_at TIMESTAMP
      );
      CREATE TABLE "${modelName}" (
         uid TEXT PRIMARY KEY,
         label TEXT NOT NULL
      );
   `)
   const db = drizzle(pglite)
   const metaTable = pgTable('metadata', {
      uid: text('uid').primaryKey(),
      created_at: timestamp(),
      updated_at: timestamp(),
      deleted_at: timestamp(),
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
      await db.insert(metaTable).values({ uid: 'r1', created_at: T0 })

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

   test('create() rollback removes metadata when server rejects', async () => {
      const modelName = `model${++dbCounter}`

      const { clientApp, cleanup } = await createTestContext(serverApp => {
         serverApp.createService(modelName, {
            createWithMeta: async () => { throw new Error('server rejected') },
            findMany:        async () => [],
            updateWithMeta:  async () => {},
            deleteWithMeta:  async () => {},
         })
         serverApp.createService('sync', {
            go: async () => ({ addClient: [], updateClient: [], deleteClient: [], addDatabase: [], updateDatabase: [] }),
         })
      }, { useOfflinePlugin: true })

      try {
         const model = clientApp.createOfflineModel(modelName, ['label'])

         // create() is optimistic: value + metadata are written to Dexie before the
         // server responds, then rolled back if the server rejects.
         const record = await model.create({ label: 'test' })
         const uid = record.uid

         assert.ok(await model.db.values.get(uid),    'value should exist optimistically')
         assert.ok(await model.db.metadata.get(uid),  'metadata should exist optimistically')

         // Poll until the rollback removes the value (server rejection processed)
         for (let i = 0; i < 50; i++) {
            await new Promise(r => setTimeout(r, 10))
            if (!await model.db.values.get(uid)) break
         }

         assert.ok(!await model.db.values.get(uid),   'value should be removed after rollback')
         // Metadata must also be cleaned up — currently it is not
         assert.ok(!await model.db.metadata.get(uid), 'metadata should also be removed after rollback')
      } finally {
         await cleanup()
      }
   })

   test('deleted record is fully removed from Dexie metadata after sync', async () => {
      const modelName = `model${++dbCounter}`
      const { db, metaTable, modelTable } = await createTestDb(modelName)

      const { clientApp, cleanup } = await createTestContext(
         serverApp => serverApp.configure(drizzleOfflinePlugin, db, metaTable, [modelTable]),
         { useOfflinePlugin: true },
      )

      try {
         const model = clientApp.createOfflineModel(modelName, ['label'])
         // Record created and deleted locally before ever reaching the server
         await model.db.values.add({ uid: 'd1', label: 'Gone', __deleted__: true })
         await model.db.metadata.add({ uid: 'd1', created_at: T0, deleted_at: T1 })
         await model.addSynchroWhere({})
         await model.synchronizeAll()

         const d1 = await model.db.values.get('d1')
         assert.ok(!d1, 'Dexie values should not hold deleted record')

         // Metadata must also be removed — orphaned rows waste space and cause
         // a ConstraintError if a record with the same uid is ever re-created
         const d1Meta = await model.db.metadata.get('d1')
         assert.ok(!d1Meta, 'Dexie metadata should also be removed for deleted record')
      } finally {
         await cleanup()
      }
   })

   test('record in both, DB newer → client cache is updated with server value', async () => {
      const modelName = `model${++dbCounter}`
      const { db, metaTable, modelTable } = await createTestDb(modelName)

      // Server has s1 at T2 (newer than client)
      await db.insert(modelTable).values({ uid: 's1', label: 'server-v2' })
      await db.insert(metaTable).values({ uid: 's1', created_at: T0, updated_at: T2 })

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

   test('one failed updateWithMeta does not abort remaining updateDatabase entries', async () => {
      const modelName = `model${++dbCounter}`
      const serverUpdated = {}

      const { clientApp, cleanup } = await createTestContext(serverApp => {
         serverApp.createService('sync', {
            // Tell the client both u1 and u2 need to be pushed (client is newer for both)
            go: async (mn, where, cutoff, clientMetadataDict) => ({
               addClient: [], updateClient: [], deleteClient: [], addDatabase: [],
               updateDatabase: [ clientMetadataDict['u1'], clientMetadataDict['u2'] ],
            }),
         })
         serverApp.createService(modelName, {
            updateWithMeta: async (uid, data) => {
               if (uid === 'u1') throw new Error('server rejected u1')
               serverUpdated[uid] = data  // u2 succeeds
            },
            createWithMeta: async () => {},
            deleteWithMeta: async () => {},
            findUnique:     async () => null,
            findMany:       async () => [],
         })
      }, { useOfflinePlugin: true })

      try {
         const model = clientApp.createOfflineModel(modelName, ['label'])
         await model.db.values.add({ uid: 'u1', label: 'new-u1' })
         await model.db.metadata.add({ uid: 'u1', created_at: T0, updated_at: T2 })
         await model.db.values.add({ uid: 'u2', label: 'new-u2' })
         await model.db.metadata.add({ uid: 'u2', created_at: T0, updated_at: T2 })
         await model.addSynchroWhere({})
         await model.synchronizeAll()

         // u2's push must succeed even though u1's updateWithMeta threw
         assert.ok(serverUpdated['u2'], 'u2 should be pushed to server despite u1 failure')
         assert.equal(serverUpdated['u2'].label, 'new-u2')
      } finally {
         await cleanup()
      }
   })

   test('record in both, client newer → server is updated via socket', async () => {
      const modelName = `model${++dbCounter}`
      const { db, metaTable, modelTable } = await createTestDb(modelName)

      await db.insert(modelTable).values({ uid: 'u1', label: 'old' })
      await db.insert(metaTable).values({ uid: 'u1', created_at: T0, updated_at: T1 })

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
      await db.insert(metaTable).values({ uid: 'r1', created_at: T0 })

      // Server-side delete while client was offline: hard-delete from model table,
      // but metadata row stays with deleted_at set (this is what deleteWithMeta does)
      await db.delete(modelTable).where(eq(modelTable.uid, 'r1'))
      await db.update(metaTable).set({ deleted_at: T1 }).where(eq(metaTable.uid, 'r1'))

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

   test('addClient succeeds even when orphaned metadata already exists in Dexie', async () => {
      // The deleteWithMeta pub/sub handler does db.metadata.put(meta) which leaves
      // an orphaned metadata row after the value is deleted. If the same record is
      // later re-created on the server, addClient tries idbMetadata.add() which
      // throws a ConstraintError (PK already taken by the orphan), aborting the
      // entire addClient transaction — the record never arrives in the client cache.
      const modelName = `model${++dbCounter}`
      const { db, metaTable, modelTable } = await createTestDb(modelName)

      await db.insert(modelTable).values({ uid: 'r1', label: 'from-server' })
      await db.insert(metaTable).values({ uid: 'r1', created_at: T0 })

      const { clientApp, cleanup } = await createTestContext(
         serverApp => serverApp.configure(drizzleOfflinePlugin, db, metaTable, [modelTable]),
         { useOfflinePlugin: true },
      )

      try {
         const model = clientApp.createOfflineModel(modelName, ['label'])

         // Simulate the orphaned metadata left by a deleteWithMeta pub/sub event:
         // the value row is gone but the metadata row remains with deleted_at set.
         await model.db.metadata.add({ uid: 'r1', created_at: T0, deleted_at: T1 })

         await model.addSynchroWhere({})
         await model.synchronizeAll()

         const r1 = await model.db.values.get('r1')
         assert.ok(r1, 'r1 should be pulled into Dexie via addClient despite orphaned metadata')
         assert.equal(r1.label, 'from-server')
      } finally {
         await cleanup()
      }
   })

   test('wherePredicate handles null equality correctly', async () => {
      // After fixing the TypeError on null, the previous fix used `value !== null`
      // to guard the object branch — but that leaves null with NO branch at all,
      // so `where = { user_uid: null }` passes every record instead of only those
      // with user_uid === null.  In synchronize() this causes records with a non-null
      // user_uid to appear as addDatabase, hit a PK conflict, and get deleted.
      const modelName = `model${++dbCounter}`
      const { db, metaTable, modelTable } = await createTestDb(modelName)

      const { clientApp, cleanup } = await createTestContext(
         serverApp => serverApp.configure(drizzleOfflinePlugin, db, metaTable, [modelTable]),
         { useOfflinePlugin: true },
      )

      try {
         const model = clientApp.createOfflineModel(modelName, ['label'])

         await model.db.values.add({ uid: 'r1', label: 'with-user', user_uid: 'u1' })
         await model.db.values.add({ uid: 'r2', label: 'no-user',   user_uid: null })

         const results = await model.findWhere({ user_uid: null })
         const uids = results.map(r => r.uid)

         assert.ok(!uids.includes('r1'), 'record with user_uid=u1 should NOT match { user_uid: null }')
         assert.ok( uids.includes('r2'), 'record with user_uid=null should match { user_uid: null }')
      } finally {
         await cleanup()
      }
   })

   test('wherePredicate handles falsy boundary value (lte: 0) correctly', async () => {
      // wherePredicate is used by synchronize() to build clientMetadataDict.
      // A falsy boundary (lte: 0) is checked with `if (value.lte)` which treats 0
      // as "not set", causing ALL records to pass — wrong records enter clientMetadataDict
      // and the sync pushes them to the server where they fail with PK conflicts,
      // then the rollback deletes them from Dexie (data loss).
      const modelName = `model${++dbCounter}`
      const { db, metaTable, modelTable } = await createTestDb(modelName)

      const { clientApp, cleanup } = await createTestContext(
         serverApp => serverApp.configure(drizzleOfflinePlugin, db, metaTable, [modelTable]),
         { useOfflinePlugin: true },
      )

      try {
         const model = clientApp.createOfflineModel(modelName, ['label'])

         // Dexie stores arbitrary fields — score is not indexed but is queryable
         await model.db.values.add({ uid: 'pos',  label: 'positive', score:  5 })
         await model.db.values.add({ uid: 'neg',  label: 'negative', score: -3 })
         await model.db.values.add({ uid: 'zero', label: 'zero',     score:  0 })

         const results = await model.findWhere({ score: { lte: 0 } })
         const uids = results.map(r => r.uid)

         assert.ok(!uids.includes('pos'),  'score=5  should NOT match { lte: 0 }')
         assert.ok( uids.includes('neg'),  'score=-3 should match { lte: 0 }')
         assert.ok( uids.includes('zero'), 'score=0  should match { lte: 0 }')
      } finally {
         await cleanup()
      }
   })

   test('pub/sub createWithMeta event correctly updates a second client\'s Dexie', async () => {
      const modelName = `model${++dbCounter}`
      const { db, metaTable, modelTable } = await createTestDb(modelName)

      // Server with pub/sub: every client joins 'all' and createWithMeta broadcasts there
      const serverApp = expressX({})
      serverApp.configure(drizzleOfflinePlugin, db, metaTable, [modelTable])
      serverApp.addConnectListener(socket => serverApp.joinChannel('all', socket))
      serverApp.service(modelName).publish(async () => ['all'])
      await new Promise(resolve => serverApp.httpServer.listen(0, resolve))
      const port = serverApp.httpServer.address().port

      function connectClient() {
         const socket = ioc(`http://localhost:${port}`, { transports: ['websocket'], autoConnect: false })
         const app = createClient(socket, { debug: false })
         offlinePlugin(app)
         socket.connect()
         return new Promise((resolve, reject) => {
            socket.on('connect', () => resolve({ app, socket }))
            socket.on('connect_error', reject)
         })
      }

      const { app: appA, socket: socketA } = await connectClient()
      const { app: appB, socket: socketB } = await connectClient()

      const modelA = appA.createOfflineModel(modelName, ['label'])
      const modelB = appB.createOfflineModel(modelName, ['label'])

      try {
         // Client A creates a record while connected — fires createWithMeta directly
         const record = await modelA.create({ label: 'from-A' })

         // Poll until the pub/sub event reaches client B's Dexie
         let inB = null
         for (let i = 0; i < 50; i++) {
            await new Promise(r => setTimeout(r, 10))
            inB = await modelB.db.values.get(record.uid)
            if (inB) break
         }

         assert.ok(inB, 'Client B should receive the record via pub/sub')
         assert.equal(inB.label, 'from-A', 'Client B should have the correct label')
      } finally {
         socketA.disconnect()
         socketB.disconnect()
         await new Promise(resolve => serverApp.httpServer.close(resolve))
      }
   })

})
