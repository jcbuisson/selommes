import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'

import { computeSyncResult, runSync } from '#root/src/drizzle-plugins.mjs'

const T0 = new Date('2026-01-01T00:00:00Z')
const T1 = new Date('2026-01-02T00:00:00Z')
const T2 = new Date('2026-01-03T00:00:00Z')

// ─── Dialog helpers ────────────────────────────────────────────────────────────
// Lightweight simulations of server (drizzle-plugins.mjs) and client (client.mts)
// that run the sync protocol using plain objects instead of Dexie / PostgreSQL.

function matchesWhere(value, where) {
   return Object.entries(where).every(([k, v]) => value[k] === v)
}

function createServer(initialValues = {}, initialMetadata = {}) {
   const values   = structuredClone(initialValues)
   const metadata = structuredClone(initialMetadata)

   return {
      values,
      metadata,

      // Mirrors drizzle-plugins.mjs go(): runs runSync with plain-object storage
      async sync(where, clientMetadataDict) {
         const databaseValuesDict = Object.fromEntries(
            Object.entries(values).filter(([, v]) => matchesWhere(v, where))
         )
         return runSync(
            databaseValuesDict,
            clientMetadataDict,
            uid => Promise.resolve(metadata[uid] ?? null),
            async (uid, deleted_at) => {
               delete values[uid]
               if (metadata[uid]) metadata[uid] = { ...metadata[uid], deleted_at }
            }
         )
      },

      // Called by client step 3 (updateClient): get authoritative value
      findUnique(uid) { return values[uid] ?? null },

      // Called by client step 4 (addDatabase)
      async createWithMeta(uid, data, created_at) {
         values[uid] = { uid, ...data }
         metadata[uid] = { uid, created_at }
      },

      // Called by client step 5 (updateDatabase)
      async updateWithMeta(uid, data, updated_at) {
         if (values[uid]) {
            Object.assign(values[uid], data)
            metadata[uid] = { ...metadata[uid], updated_at }
         }
      },
   }
}

function createClient(initialValues = {}, initialMetadata = {}) {
   const values   = structuredClone(initialValues)
   const metadata = structuredClone(initialMetadata)

   return {
      values,
      metadata,

      // Mirrors client.mts synchronize(): builds clientMetadataDict, calls server,
      // then applies each part of the result (steps 1-5).
      async sync(where, server) {
         // Collect metadata for all local records matching `where` (including __deleted__)
         const clientMetadataDict = {}
         for (const [uid, value] of Object.entries(values)) {
            const { __deleted__, ...rest } = value
            if (matchesWhere(rest, where)) {
               clientMetadataDict[uid] = metadata[uid] || {}
            }
         }

         const { addClient, updateClient, deleteClient, addDatabase, updateDatabase } =
            await server.sync(where, clientMetadataDict)

         // Step 1: add DB-only records to local cache
         for (const [value, meta] of addClient) {
            values[value.uid] = { ...value }
            metadata[value.uid] = { ...meta }
         }

         // Step 2: remove records deleted on server (or acknowledged deletions)
         for (const [uid] of deleteClient) {
            delete values[uid]
         }

         // Step 3: overwrite stale local records with the server's authoritative version
         for (const elt of updateClient) {
            const full = server.findUnique(elt.uid)
            if (full) values[elt.uid] = { ...full }
         }

         // Step 4: push client-only records to server
         for (const meta of addDatabase) {
            const { uid, __deleted__, ...data } = values[meta.uid] ?? {}
            await server.createWithMeta(meta.uid, data, meta.created_at)
         }

         // Step 5: push locally-updated records to server
         for (const meta of updateDatabase) {
            const { uid, __deleted__, ...data } = values[meta.uid] ?? {}
            await server.updateWithMeta(meta.uid, data, meta.updated_at)
         }
      },
   }
}

describe('dialog: client ↔ server convergence', () => {

   test('empty client pulls all records from DB', async () => {
      const server = createServer(
         { a: { uid: 'a', label: 'Vacances' } },
         { a: { uid: 'a', created_at: T0 } }
      )
      const client = createClient()

      await client.sync({}, server)

      assert.deepEqual(client.values['a'], { uid: 'a', label: 'Vacances' })
      assert.deepEqual(client.metadata['a'], { uid: 'a', created_at: T0 })
      // server unchanged
      assert.ok(server.values['a'])
   })

   test('client-only record is pushed to DB', async () => {
      const server = createServer()
      const client = createClient(
         { b: { uid: 'b', label: 'Formation' } },
         { b: { uid: 'b', created_at: T1 } }
      )

      await client.sync({}, server)

      assert.ok(server.values['b'])
      assert.equal(server.values['b'].label, 'Formation')
      assert.deepEqual(server.metadata['b'].created_at, T1)
   })

   test('client update (newer) wins: DB is overwritten', async () => {
      const server = createServer(
         { c: { uid: 'c', label: 'old' } },
         { c: { uid: 'c', created_at: T0, updated_at: T1 } }
      )
      const client = createClient(
         { c: { uid: 'c', label: 'new' } },
         { c: { uid: 'c', created_at: T0, updated_at: T2 } }
      )

      await client.sync({}, server)

      assert.equal(server.values['c'].label, 'new')
      assert.equal(client.values['c'].label, 'new') // client unchanged
   })

   test('DB update (newer) wins: client is overwritten', async () => {
      const server = createServer(
         { d: { uid: 'd', label: 'new' } },
         { d: { uid: 'd', created_at: T0, updated_at: T2 } }
      )
      const client = createClient(
         { d: { uid: 'd', label: 'old' } },
         { d: { uid: 'd', created_at: T0, updated_at: T1 } }
      )

      await client.sync({}, server)

      assert.equal(client.values['d'].label, 'new')
      assert.equal(server.values['d'].label, 'new') // server unchanged
   })

   test('client deletion propagates to DB', async () => {
      const server = createServer(
         { e: { uid: 'e', label: 'bye' } },
         { e: { uid: 'e', created_at: T0 } }
      )
      const client = createClient(
         { e: { uid: 'e', label: 'bye', __deleted__: true } },
         { e: { uid: 'e', created_at: T0, deleted_at: T1 } }
      )

      await client.sync({}, server)

      assert.ok(!server.values['e'])
      assert.ok(!client.values['e'])
   })

   test('already-in-sync records cause no server writes', async () => {
      const server = createServer(
         { f: { uid: 'f', label: 'same' } },
         { f: { uid: 'f', created_at: T0, updated_at: T1 } }
      )
      const client = createClient(
         { f: { uid: 'f', label: 'same' } },
         { f: { uid: 'f', created_at: T0, updated_at: T1 } }
      )
      const createWithMeta = mock.fn()
      const updateWithMeta = mock.fn()
      server.createWithMeta = createWithMeta
      server.updateWithMeta = updateWithMeta

      await client.sync({}, server)

      assert.equal(createWithMeta.mock.calls.length, 0)
      assert.equal(updateWithMeta.mock.calls.length, 0)
      assert.equal(client.values['f'].label, 'same')
   })

   test('where clause scopes sync to matching records only', async () => {
      const server = createServer(
         {
            g1: { uid: 'g1', user_uid: 'u1', label: 'A' },
            g2: { uid: 'g2', user_uid: 'u2', label: 'B' },
         },
         {
            g1: { uid: 'g1', created_at: T0 },
            g2: { uid: 'g2', created_at: T0 },
         }
      )
      const client = createClient()

      await client.sync({ user_uid: 'u1' }, server)

      assert.ok(client.values['g1'])
      assert.ok(!client.values['g2']) // out of scope
   })

   test('mixed scenario: pull, push, and update in one sync', async () => {
      const server = createServer(
         {
            db: { uid: 'db', label: 'db-only' },     // client will pull
            shared: { uid: 'shared', label: 'old' }, // client has newer version
         },
         {
            db:     { uid: 'db',     created_at: T0 },
            shared: { uid: 'shared', created_at: T0, updated_at: T1 },
         }
      )
      const client = createClient(
         {
            local:  { uid: 'local',  label: 'local-only' }, // client will push
            shared: { uid: 'shared', label: 'new' },        // client is newer
         },
         {
            local:  { uid: 'local',  created_at: T1 },
            shared: { uid: 'shared', created_at: T0, updated_at: T2 },
         }
      )

      await client.sync({}, server)

      assert.equal(client.values['db'].label, 'db-only')        // pulled from DB
      assert.ok(server.values['local'])                          // pushed to DB
      assert.equal(server.values['shared'].label, 'new')        // server updated
      assert.equal(client.values['shared'].label, 'new')        // client unchanged
   })

})

describe('runSync — synchronization process', () => {

   test('DB record absent from client → returned in addClient, metadata fetched', async () => {
      const value = { uid: 'a', label: 'Vacances' }
      const meta  = { uid: 'a', created_at: T0 }
      const getMetadata = mock.fn(async () => meta)
      const deleteRecord = mock.fn()

      const result = await runSync({ a: value }, {}, getMetadata, deleteRecord)

      assert.equal(getMetadata.mock.calls.length, 1)
      assert.equal(getMetadata.mock.calls[0].arguments[0], 'a')
      assert.deepEqual(result.addClient, [[value, meta]])
      assert.deepEqual(result.addDatabase, [])
      assert.equal(deleteRecord.mock.calls.length, 0)
   })

   test('client record absent from DB → returned in addDatabase, no metadata fetched', async () => {
      const clientMeta = { uid: 'b', created_at: T1 }
      const getMetadata = mock.fn()
      const deleteRecord = mock.fn()

      const result = await runSync({}, { b: clientMeta }, getMetadata, deleteRecord)

      assert.equal(getMetadata.mock.calls.length, 0)
      assert.deepEqual(result.addDatabase, [clientMeta])
      assert.deepEqual(result.addClient, [])
      assert.equal(deleteRecord.mock.calls.length, 0)
   })

   test('client deleted a record present in DB → deleteRecord called, returned in deleteClient', async () => {
      const value      = { uid: 'c', label: 'bye' }
      const dbMeta     = { uid: 'c', created_at: T0 }
      const clientMeta = { uid: 'c', created_at: T0, deleted_at: T1 }
      const getMetadata = mock.fn(async () => dbMeta)
      const deleteRecord = mock.fn(async () => {})

      const result = await runSync({ c: value }, { c: clientMeta }, getMetadata, deleteRecord)

      assert.equal(deleteRecord.mock.calls.length, 1)
      assert.equal(deleteRecord.mock.calls[0].arguments[0], 'c')
      assert.equal(deleteRecord.mock.calls[0].arguments[1], T1)
      assert.deepEqual(result.deleteClient, [['c', T1]])
      assert.deepEqual(result.addDatabase, [])
   })

   test('conflict: client newer → returned in updateDatabase, deleteRecord not called', async () => {
      const value      = { uid: 'd', label: 'old' }
      const dbMeta     = { uid: 'd', created_at: T0, updated_at: T1 }
      const clientMeta = { uid: 'd', created_at: T0, updated_at: T2 }
      const getMetadata = mock.fn(async () => dbMeta)
      const deleteRecord = mock.fn()

      const result = await runSync({ d: value }, { d: clientMeta }, getMetadata, deleteRecord)

      assert.deepEqual(result.updateDatabase, [clientMeta])
      assert.deepEqual(result.updateClient, [])
      assert.equal(deleteRecord.mock.calls.length, 0)
   })

   test('conflict: DB newer → returned in updateClient, deleteRecord not called', async () => {
      const value      = { uid: 'e', label: 'new' }
      const dbMeta     = { uid: 'e', created_at: T0, updated_at: T2 }
      const clientMeta = { uid: 'e', created_at: T0, updated_at: T1 }
      const getMetadata = mock.fn(async () => dbMeta)
      const deleteRecord = mock.fn()

      const result = await runSync({ e: value }, { e: clientMeta }, getMetadata, deleteRecord)

      assert.deepEqual(result.updateClient, [value])
      assert.deepEqual(result.updateDatabase, [])
      assert.equal(deleteRecord.mock.calls.length, 0)
   })

   test('missing metadata falls back gracefully (no crash)', async () => {
      const value = { uid: 'f', label: 'x' }
      const clientMeta = { uid: 'f', created_at: T1 }
      const getMetadata = mock.fn(async () => null)
      const deleteRecord = mock.fn()

      // DB has the record but metadata is missing → treated as created_at = now
      // client has updated_at T1, db fallback created_at = now (T1 < now → updateClient)
      const result = await runSync({ f: value }, { f: clientMeta }, getMetadata, deleteRecord)
      assert.equal(getMetadata.mock.calls.length, 1)
      assert.ok(result.updateClient.length + result.updateDatabase.length <= 1)
   })

   test('getMetadata called once per DB uid, not for client-only uids', async () => {
      const dbValue1 = { uid: 'x', label: 'x' }
      const dbValue2 = { uid: 'y', label: 'y' }
      const dbMeta1  = { uid: 'x', created_at: T0 }
      const dbMeta2  = { uid: 'y', created_at: T0 }
      const clientOnly = { uid: 'z', created_at: T1 }

      const metaMap = { x: dbMeta1, y: dbMeta2 }
      const getMetadata = mock.fn(async uid => metaMap[uid] ?? null)
      const deleteRecord = mock.fn()

      await runSync(
         { x: dbValue1, y: dbValue2 },
         { z: clientOnly },
         getMetadata,
         deleteRecord,
      )

      assert.equal(getMetadata.mock.calls.length, 2)
      const fetchedUids = getMetadata.mock.calls.map(c => c.arguments[0]).sort()
      assert.deepEqual(fetchedUids, ['x', 'y'])
   })

})

describe('computeSyncResult', () => {

   test('both empty → all arrays empty', () => {
      const result = computeSyncResult({}, {}, {})
      assert.deepEqual(result.addClient, [])
      assert.deepEqual(result.updateClient, [])
      assert.deepEqual(result.deleteClient, [])
      assert.deepEqual(result.addDatabase, [])
      assert.deepEqual(result.updateDatabase, [])
      assert.deepEqual(result.deleteDatabase, [])
   })

   test('record only in DB → sent to client (addClient)', () => {
      const value = { uid: 'a', label: 'Vacances' }
      const meta  = { uid: 'a', created_at: T0 }
      const result = computeSyncResult({ a: value }, {}, { a: meta })
      assert.equal(result.addClient.length, 1)
      assert.deepEqual(result.addClient[0], [value, meta])
      assert.deepEqual(result.addDatabase, [])
   })

   test('record only on client, not deleted → sent to database (addDatabase)', () => {
      const clientMeta = { uid: 'b', created_at: T0 }
      const result = computeSyncResult({}, { b: clientMeta }, {})
      assert.deepEqual(result.addDatabase, [clientMeta])
      assert.deepEqual(result.addClient, [])
      assert.deepEqual(result.deleteClient, [])
   })

   test('record only on client, deleted → ignored on both sides (deleteClient)', () => {
      const clientMeta = { uid: 'c', created_at: T0, deleted_at: T1 }
      const result = computeSyncResult({}, { c: clientMeta }, {})
      assert.deepEqual(result.deleteClient, [['c', T1]])
      assert.deepEqual(result.addDatabase, [])
   })

   test('record in both, client newer → update database (updateDatabase)', () => {
      const value      = { uid: 'd', label: 'old' }
      const dbMeta     = { uid: 'd', created_at: T0, updated_at: T1 }
      const clientMeta = { uid: 'd', created_at: T0, updated_at: T2 }
      const result = computeSyncResult({ d: value }, { d: clientMeta }, { d: dbMeta })
      assert.deepEqual(result.updateDatabase, [clientMeta])
      assert.deepEqual(result.updateClient, [])
   })

   test('record in both, DB newer → update client (updateClient)', () => {
      const value      = { uid: 'e', label: 'new' }
      const dbMeta     = { uid: 'e', created_at: T0, updated_at: T2 }
      const clientMeta = { uid: 'e', created_at: T0, updated_at: T1 }
      const result = computeSyncResult({ e: value }, { e: clientMeta }, { e: dbMeta })
      assert.deepEqual(result.updateClient, [value])
      assert.deepEqual(result.updateDatabase, [])
   })

   test('record in both, same timestamp → no action', () => {
      const value      = { uid: 'f', label: 'same' }
      const dbMeta     = { uid: 'f', created_at: T0, updated_at: T1 }
      const clientMeta = { uid: 'f', created_at: T0, updated_at: T1 }
      const result = computeSyncResult({ f: value }, { f: clientMeta }, { f: dbMeta })
      assert.deepEqual(result.updateClient, [])
      assert.deepEqual(result.updateDatabase, [])
   })

   test('record in both, client deleted → delete on DB and notify client', () => {
      const value      = { uid: 'g', label: 'bye' }
      const dbMeta     = { uid: 'g', created_at: T0 }
      const clientMeta = { uid: 'g', created_at: T0, deleted_at: T1 }
      const result = computeSyncResult({ g: value }, { g: clientMeta }, { g: dbMeta })
      assert.deepEqual(result.deleteDatabase, ['g'])
      assert.deepEqual(result.deleteClient, [['g', T1]])
   })

   test('mixed scenario: one of each case', () => {
      const dbOnly      = { uid: 'db', label: 'db-only' }
      const dbOnlyMeta  = { uid: 'db', created_at: T0 }

      const clientNewMeta = { uid: 'cn', created_at: T1 }

      const sharedValue       = { uid: 'sh', label: 'shared' }
      const sharedDbMeta      = { uid: 'sh', created_at: T0, updated_at: T1 }
      const sharedClientMeta  = { uid: 'sh', created_at: T0, updated_at: T2 }

      const result = computeSyncResult(
         { db: dbOnly, sh: sharedValue },
         { cn: clientNewMeta, sh: sharedClientMeta },
         { db: dbOnlyMeta, sh: sharedDbMeta },
      )

      assert.equal(result.addClient.length, 1)
      assert.deepEqual(result.addClient[0], [dbOnly, dbOnlyMeta])
      assert.deepEqual(result.addDatabase, [clientNewMeta])
      assert.deepEqual(result.updateDatabase, [sharedClientMeta])
      assert.deepEqual(result.updateClient, [])
      assert.deepEqual(result.deleteClient, [])
      assert.deepEqual(result.deleteDatabase, [])
   })

})
