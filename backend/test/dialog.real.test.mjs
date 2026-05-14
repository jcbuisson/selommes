// Must be imported before Dexie so it patches globalThis.indexedDB first
import 'fake-indexeddb/auto'

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { offlinePlugin } from '../../frontend/src/client.mts'
import { runSync } from '#root/src/drizzle-plugins.mjs'

const T0 = new Date('2026-01-01T00:00:00Z')
const T1 = new Date('2026-01-02T00:00:00Z')
const T2 = new Date('2026-01-03T00:00:00Z')

function matchesWhere(value, where) {
   return Object.entries(where).every(([k, v]) => value[k] === v)
}

// Builds a minimal app that satisfies both offlinePlugin (client side) and
// acts as the server — routing service('sync').go() through runSync and
// handling createWithMeta / updateWithMeta / findUnique on plain objects.
function createTestApp(serverValues = {}, serverMetadata = {}) {
   const values   = structuredClone(serverValues)
   const metadata = structuredClone(serverMetadata)

   return {
      isConnected: true,
      disconnectedDate: null,
      connectedDate: new Date(),
      serverState: { values, metadata },

      service(name) {
         if (name === 'sync') {
            return {
               on: () => {},
               go: async (modelName, where, _cutoffDate, clientMetadataDict) => {
                  const dbValuesDict = Object.fromEntries(
                     Object.entries(values).filter(([, v]) => matchesWhere(v, where))
                  )
                  return runSync(
                     dbValuesDict,
                     clientMetadataDict,
                     uid => Promise.resolve(metadata[uid] ?? null),
                     async (uid, deleted_at) => {
                        delete values[uid]
                        if (metadata[uid]) metadata[uid] = { ...metadata[uid], deleted_at }
                     }
                  )
               },
            }
         }
         // Model service: handles callbacks from the client during sync steps 3-5
         return {
            on: () => {},
            findUnique: async (args) => {
               // client calls findUnique({ where: { uid } })
               // structuredClone mirrors the deep copy that JSON serialisation gives in production
               const uid = args?.where?.uid ?? args?.uid
               return values[uid] ? structuredClone(values[uid]) : null
            },
            createWithMeta: async (uid, data, created_at) => {
               values[uid] = { uid, ...data }
               metadata[uid] = { uid, created_at }
            },
            updateWithMeta: async (uid, data, updated_at) => {
               if (values[uid]) Object.assign(values[uid], data)
               if (metadata[uid]) metadata[uid] = { ...metadata[uid], updated_at }
            },
         }
      },

      addConnectListener:    () => {},
      addDisconnectListener: () => {},
      addErrorListener:      () => {},
   }
}

function setupMockedClient() {
   return {
      isConnected: true,
      disconnectedDate: null,
      connectedDate: new Date(),
      addConnectListener:    () => {},
      addDisconnectListener: () => {},
      addErrorListener:      () => {},


      service(name) {
         if (name === 'sync') {
            return {
               on: () => {},
               go: async (modelName, where, _cutoffDate, clientMetadataDict) => {
                  const dbValuesDict = Object.fromEntries(
                     Object.entries(values).filter(([, v]) => matchesWhere(v, where))
                  )
                  return runSync(
                     dbValuesDict,
                     clientMetadataDict,
                     uid => Promise.resolve(metadata[uid] ?? null),
                     async (uid, deleted_at) => {
                        delete values[uid]
                        if (metadata[uid]) metadata[uid] = { ...metadata[uid], deleted_at }
                     }
                  )
               },
            }
         }
         // Model service: handles callbacks from the client during sync steps 3-5
         return {
            on: () => {},
            findUnique: async (args) => {
               // client calls findUnique({ where: { uid } })
               // structuredClone mirrors the deep copy that JSON serialisation gives in production
               const uid = args?.where?.uid ?? args?.uid
               return values[uid] ? structuredClone(values[uid]) : null
            },
            createWithMeta: async (uid, data, created_at) => {
               values[uid] = { uid, ...data }
               metadata[uid] = { uid, created_at }
            },
            updateWithMeta: async (uid, data, updated_at) => {
               if (values[uid]) Object.assign(values[uid], data)
               if (metadata[uid]) metadata[uid] = { ...metadata[uid], updated_at }
            },
         }
      },

   }
}

function setupMockedServer(serverValues = {}, serverMetadata = {}) {
   const values   = structuredClone(serverValues)
   const metadata = structuredClone(serverMetadata)

   return {
      serverState: { values, metadata },

      service(name) {
         if (name === 'sync') {
            return {
               on: () => {},
               go: async (modelName, where, _cutoffDate, clientMetadataDict) => {
                  const dbValuesDict = Object.fromEntries(
                     Object.entries(values).filter(([, v]) => matchesWhere(v, where))
                  )
                  return runSync(
                     dbValuesDict,
                     clientMetadataDict,
                     uid => Promise.resolve(metadata[uid] ?? null),
                     async (uid, deleted_at) => {
                        delete values[uid]
                        if (metadata[uid]) metadata[uid] = { ...metadata[uid], deleted_at }
                     }
                  )
               },
            }
         }
         // Model service: handles callbacks from the client during sync steps 3-5
         return {
            on: () => {},
            findUnique: async (args) => {
               // client calls findUnique({ where: { uid } })
               // structuredClone mirrors the deep copy that JSON serialisation gives in production
               const uid = args?.where?.uid ?? args?.uid
               return values[uid] ? structuredClone(values[uid]) : null
            },
            createWithMeta: async (uid, data, created_at) => {
               values[uid] = { uid, ...data }
               metadata[uid] = { uid, created_at }
            },
            updateWithMeta: async (uid, data, updated_at) => {
               if (values[uid]) Object.assign(values[uid], data)
               if (metadata[uid]) metadata[uid] = { ...metadata[uid], updated_at }
            },
         }
      },
   }
}

// Each test gets a unique Dexie database name so instances never collide
let dbCounter = 0

async function setup(serverValues = {}, serverMetadata = {}) {

   const app = createTestApp(serverValues, serverMetadata)

   offlinePlugin(app)
   
   const model = app.createOfflineModel(`test-${++dbCounter}`, ['label', 'user_uid'])
   await model.addSynchroWhere({})
   return { app, model }
}

// ─────────────────────────────────────────────────────────────────────────────

describe('client ↔ server synchronization', () => {

   test('empty client pulls all records from server', async () => {

      const appServer = setupMockedServer(
         { a: { uid: 'a', label: 'Vacances' } },
         { a: { uid: 'a', created_at: T0 } },
      );

      const appClient = setupMockedClient();
      offlinePlugin(appClient);
      const model = appClient.createOfflineModel(`test-${++dbCounter}`, ['label', 'user_uid']);

      // run synchro on where={}
      model.addSynchroWhere({});
      await model.synchronizeAll();

      const value = await model.db.values.get('a')
      const meta  = await model.db.metadata.get('a')
      assert.ok(value, 'record should be in client Dexie')
      assert.equal(value.label, 'Vacances')
      assert.deepEqual(meta.created_at, T0)
      // server untouched
      assert.ok(appServer.serverState.values['a'])
   })

   test('empty client pulls all records from server', async () => {
      const { app, model } = await setup(
         { a: { uid: 'a', label: 'Vacances' } },
         { a: { uid: 'a', created_at: T0 } },
      )

      await model.synchronizeAll()

      const value = await model.db.values.get('a')
      const meta  = await model.db.metadata.get('a')
      assert.ok(value, 'record should be in client Dexie')
      assert.equal(value.label, 'Vacances')
      assert.deepEqual(meta.created_at, T0)
      // server untouched
      assert.ok(app.serverState.values['a'])
   })

   test('client-only record is pushed to server', async () => {
      const { app, model } = await setup()

      await model.db.values.add({ uid: 'b', label: 'Formation' })
      await model.db.metadata.add({ uid: 'b', created_at: T1 })

      await model.synchronizeAll()

      assert.ok(app.serverState.values['b'], 'server should have received the record')
      assert.equal(app.serverState.values['b'].label, 'Formation')
      assert.deepEqual(app.serverState.metadata['b'].created_at, T1)
   })

   test('client update (newer) wins: server is overwritten', async () => {
      const { app, model } = await setup(
         { c: { uid: 'c', label: 'old' } },
         { c: { uid: 'c', created_at: T0, updated_at: T1 } },
      )

      await model.db.values.add({ uid: 'c', label: 'new' })
      await model.db.metadata.add({ uid: 'c', created_at: T0, updated_at: T2 })

      await model.synchronizeAll()

      assert.equal(app.serverState.values['c'].label, 'new')
      const clientValue = await model.db.values.get('c')
      assert.equal(clientValue.label, 'new') // client unchanged
   })

   test('server update (newer) wins: client Dexie is overwritten', async () => {
      const { app, model } = await setup(
         { d: { uid: 'd', label: 'new' } },
         { d: { uid: 'd', created_at: T0, updated_at: T2 } },
      )

      await model.db.values.add({ uid: 'd', label: 'old' })
      await model.db.metadata.add({ uid: 'd', created_at: T0, updated_at: T1 })

      await model.synchronizeAll()

      const clientValue = await model.db.values.get('d')
      assert.equal(clientValue.label, 'new')
      assert.equal(app.serverState.values['d'].label, 'new') // server unchanged
   })

   test('client deletion propagates to server', async () => {
      const { app, model } = await setup(
         { e: { uid: 'e', label: 'bye' } },
         { e: { uid: 'e', created_at: T0 } },
      )

      await model.db.values.add({ uid: 'e', label: 'bye', __deleted__: true })
      await model.db.metadata.add({ uid: 'e', created_at: T0, deleted_at: T1 })

      await model.synchronizeAll()

      assert.ok(!app.serverState.values['e'], 'server should no longer have the record')
      const clientValue = await model.db.values.get('e')
      assert.ok(!clientValue, 'Dexie should no longer have the record')
   })

   test('in-sync records produce no server writes', async () => {
      const { app, model } = await setup(
         { f: { uid: 'f', label: 'same' } },
         { f: { uid: 'f', created_at: T0, updated_at: T1 } },
      )

      await model.db.values.add({ uid: 'f', label: 'same' })
      await model.db.metadata.add({ uid: 'f', created_at: T0, updated_at: T1 })

      // Spy on server mutations
      let writes = 0
      const orig = app.service('__any__')
      const svc = app.service.bind(app)
      app.service = (name) => {
         const s = svc(name)
         const origCreate = s.createWithMeta
         const origUpdate = s.updateWithMeta
         s.createWithMeta = (...a) => { writes++; return origCreate?.(...a) }
         s.updateWithMeta = (...a) => { writes++; return origUpdate?.(...a) }
         return s
      }

      await model.synchronizeAll()

      assert.equal(writes, 0, 'no server writes expected for identical records')
      const clientValue = await model.db.values.get('f')
      assert.equal(clientValue.label, 'same')
   })

   test('where clause scopes sync: only matching records exchanged', async () => {
      const { app, model } = await setup(
         {
            g1: { uid: 'g1', user_uid: 'u1', label: 'A' },
            g2: { uid: 'g2', user_uid: 'u2', label: 'B' },
         },
         {
            g1: { uid: 'g1', created_at: T0 },
            g2: { uid: 'g2', created_at: T0 },
         },
      )

      // Register scoped where clause and sync only for user u1
      await model.addSynchroWhere({ user_uid: 'u1' })

      // Manually call synchronize for this scoped where (synchronizeAll covers both)
      const model2 = app.createOfflineModel(`test-${++dbCounter}`, ['label', 'user_uid'])
      await model2.addSynchroWhere({ user_uid: 'u1' })
      await model2.synchronizeAll()

      const g1 = await model2.db.values.get('g1')
      const g2 = await model2.db.values.get('g2')
      assert.ok(g1, 'g1 (user u1) should have been synced')
      assert.ok(!g2, 'g2 (user u2) should not have been synced')
   })

   test('mixed: pull + push + conflict resolved in one sync', async () => {
      const { app, model } = await setup(
         {
            db:     { uid: 'db',     label: 'db-only' },
            shared: { uid: 'shared', label: 'old' },
         },
         {
            db:     { uid: 'db',     created_at: T0 },
            shared: { uid: 'shared', created_at: T0, updated_at: T1 },
         },
      )

      // Client has a local-only record and a newer version of shared
      await model.db.values.add({ uid: 'local',  label: 'local-only' })
      await model.db.metadata.add({ uid: 'local',  created_at: T1 })
      await model.db.values.add({ uid: 'shared', label: 'new' })
      await model.db.metadata.add({ uid: 'shared', created_at: T0, updated_at: T2 })

      await model.synchronizeAll()

      // db-only record pulled to client
      const dbRec = await model.db.values.get('db')
      assert.ok(dbRec)
      assert.equal(dbRec.label, 'db-only')

      // local-only record pushed to server
      assert.ok(app.serverState.values['local'])
      assert.equal(app.serverState.values['local'].label, 'local-only')

      // client won conflict: server now has the new label
      assert.equal(app.serverState.values['shared'].label, 'new')
      const sharedRec = await model.db.values.get('shared')
      assert.equal(sharedRec.label, 'new')
   })

})
