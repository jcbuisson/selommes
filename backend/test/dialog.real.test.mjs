// Must be imported before Dexie so it patches globalThis.indexedDB first
import 'fake-indexeddb/auto'

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { createClient, offlinePlugin } from '../../frontend/src/client.mts'
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

// Each test gets a unique Dexie database name so instances never collide
let dbCounter = 0

async function setup(serverValues = {}, serverMetadata = {}) {

   const app = createTestApp(serverValues, serverMetadata)

   offlinePlugin(app)
   
   const model = app.createOfflineModel(`test-${++dbCounter}`, ['label', 'user_uid'])
   await model.addSynchroWhere({})
   return { app, model }
}

// ─── Mock socket pair ─────────────────────────────────────────────────────────
// Simulates socket.io transport in-process: client emissions are delivered
// synchronously to server handlers and vice-versa, exercising the full
// client-request / client-response protocol without any network or HTTP.

function createMockSocketPair() {
   const clientHandlers = {}
   const serverHandlers = {}

   const clientSocket = {
      id: 'mock-client',
      on(event, handler) { clientHandlers[event] = handler },
      emit(event, data) { serverHandlers[event]?.(data); return clientSocket },
      volatile: { emit(event, data) { return clientSocket.emit(event, data) } },
   }

   const serverSocket = {
      id: 'mock-server',
      on(event, handler) { serverHandlers[event] = handler },
      emit(event, data) { clientHandlers[event]?.(data) },
   }

   return {
      clientSocket,
      serverSocket,
      triggerConnect: () => clientHandlers['connect']?.(),
   }
}

// Minimal server: routes 'client-request' to registered service methods and
// emits 'client-response' — same protocol as @jcbuisson/express-x, no HTTP.
function createMockServer(socket) {
   const services = {}

   socket.on('client-request', async ({ uid, name, action, args }) => {
      try {
         const method = services[name]?.[action]
         if (!method) throw new Error(`No handler for ${name}.${action}`)
         const result = await method(...args)
         socket.emit('client-response', { uid, result })
      } catch(err) {
         socket.emit('client-response', { uid, error: err.message })
      }
   })

   return {
      register(name, methods) { services[name] = methods },
   }
}

// ─────────────────────────────────────────────────────────────────────────────

describe('mocked socket: createClient ↔ server protocol', () => {

   test('service call is routed through client-request / client-response', async () => {
      const { clientSocket, serverSocket } = createMockSocketPair()

      const server = createMockServer(serverSocket)
      server.register('greet', {
         hello: async (name) => `Hello, ${name}!`,
      })

      const clientApp = createClient(clientSocket, { debug: false })

      const result = await clientApp.service('greet').hello('World')
      assert.equal(result, 'Hello, World!')
   })

   test('server error is propagated to the client as a rejection', async () => {
      const { clientSocket, serverSocket } = createMockSocketPair()

      const server = createMockServer(serverSocket)
      server.register('broken', {
         explode: async () => { throw new Error('something went wrong') },
      })

      const clientApp = createClient(clientSocket, { debug: false })

      await assert.rejects(
         () => clientApp.service('broken').explode(),
         /something went wrong/,
      )
   })

   test('sync.go through socket: server records pulled into real Dexie', async () => {
      const { clientSocket, serverSocket, triggerConnect } = createMockSocketPair()

      const modelName  = `sock-${++dbCounter}`
      const serverValues = { r1: { uid: 'r1', label: 'Vacances' } }
      const serverMeta   = { r1: { uid: 'r1', created_at: T0 } }

      const server = createMockServer(serverSocket)
      server.register('sync', {
         go: async (mn, where, _cutoff, clientMetadataDict) => {
            const dbValuesDict = Object.fromEntries(
               Object.entries(serverValues).filter(([, v]) => matchesWhere(v, where))
            )
            return runSync(
               dbValuesDict,
               clientMetadataDict,
               uid => Promise.resolve(serverMeta[uid] ?? null),
               async () => {},
            )
         },
      })
      server.register(modelName, {
         findUnique: async ({ where: { uid } = {} } = {}) =>
            serverValues[uid] ? structuredClone(serverValues[uid]) : null,
         createWithMeta: async (uid, data, created_at) => {
            serverValues[uid] = { uid, ...data }
            serverMeta[uid]   = { uid, created_at }
         },
         updateWithMeta: async (uid, data, updated_at) => {
            if (serverValues[uid]) Object.assign(serverValues[uid], data)
            if (serverMeta[uid])   serverMeta[uid].updated_at = updated_at
         },
      })

      const clientApp = createClient(clientSocket, { debug: false })
      offlinePlugin(clientApp)
      triggerConnect() // fires offlinePlugin's connect listener → isConnected = true

      const model = clientApp.createOfflineModel(modelName, ['label'])
      await model.addSynchroWhere({})
      await model.synchronizeAll()

      const r1 = await model.db.values.get('r1')
      assert.ok(r1, 'Dexie should contain the record pulled from server via socket')
      assert.equal(r1.label, 'Vacances')
   })

   test('sync.go through socket: local Dexie record pushed to server', async () => {
      const { clientSocket, serverSocket, triggerConnect } = createMockSocketPair()

      const modelName    = `sock-${++dbCounter}`
      const serverValues = {}
      const serverMeta   = {}

      const server = createMockServer(serverSocket)
      server.register('sync', {
         go: async (mn, where, _cutoff, clientMetadataDict) =>
            runSync({}, clientMetadataDict, () => Promise.resolve(null), async () => {}),
      })
      server.register(modelName, {
         findUnique:     async () => null,
         createWithMeta: async (uid, data, created_at) => {
            serverValues[uid] = { uid, ...data }
            serverMeta[uid]   = { uid, created_at }
         },
         updateWithMeta: async () => {},
      })

      const clientApp = createClient(clientSocket, { debug: false })
      offlinePlugin(clientApp)
      triggerConnect()

      const model = clientApp.createOfflineModel(modelName, ['label'])
      await model.db.values.add({ uid: 'x1', label: 'Formation' })
      await model.db.metadata.add({ uid: 'x1', created_at: T1 })
      await model.addSynchroWhere({})
      await model.synchronizeAll()

      assert.ok(serverValues['x1'], 'server should have received the pushed record')
      assert.equal(serverValues['x1'].label, 'Formation')
   })

})

// // ─────────────────────────────────────────────────────────────────────────────

// describe('client ↔ server synchronization', () => {

//    test('empty client pulls all records from server', async () => {
//       const { app, model } = await setup(
//          { a: { uid: 'a', label: 'Vacances' } },
//          { a: { uid: 'a', created_at: T0 } },
//       )

//       await model.synchronizeAll()

//       const value = await model.db.values.get('a')
//       const meta  = await model.db.metadata.get('a')
//       assert.ok(value, 'record should be in client Dexie')
//       assert.equal(value.label, 'Vacances')
//       assert.deepEqual(meta.created_at, T0)
//       // server untouched
//       assert.ok(app.serverState.values['a'])
//    })

//    test('client-only record is pushed to server', async () => {
//       const { app, model } = await setup()

//       await model.db.values.add({ uid: 'b', label: 'Formation' })
//       await model.db.metadata.add({ uid: 'b', created_at: T1 })

//       await model.synchronizeAll()

//       assert.ok(app.serverState.values['b'], 'server should have received the record')
//       assert.equal(app.serverState.values['b'].label, 'Formation')
//       assert.deepEqual(app.serverState.metadata['b'].created_at, T1)
//    })

//    test('client update (newer) wins: server is overwritten', async () => {
//       const { app, model } = await setup(
//          { c: { uid: 'c', label: 'old' } },
//          { c: { uid: 'c', created_at: T0, updated_at: T1 } },
//       )

//       await model.db.values.add({ uid: 'c', label: 'new' })
//       await model.db.metadata.add({ uid: 'c', created_at: T0, updated_at: T2 })

//       await model.synchronizeAll()

//       assert.equal(app.serverState.values['c'].label, 'new')
//       const clientValue = await model.db.values.get('c')
//       assert.equal(clientValue.label, 'new') // client unchanged
//    })

//    test('server update (newer) wins: client Dexie is overwritten', async () => {
//       const { app, model } = await setup(
//          { d: { uid: 'd', label: 'new' } },
//          { d: { uid: 'd', created_at: T0, updated_at: T2 } },
//       )

//       await model.db.values.add({ uid: 'd', label: 'old' })
//       await model.db.metadata.add({ uid: 'd', created_at: T0, updated_at: T1 })

//       await model.synchronizeAll()

//       const clientValue = await model.db.values.get('d')
//       assert.equal(clientValue.label, 'new')
//       assert.equal(app.serverState.values['d'].label, 'new') // server unchanged
//    })

//    test('client deletion propagates to server', async () => {
//       const { app, model } = await setup(
//          { e: { uid: 'e', label: 'bye' } },
//          { e: { uid: 'e', created_at: T0 } },
//       )

//       await model.db.values.add({ uid: 'e', label: 'bye', __deleted__: true })
//       await model.db.metadata.add({ uid: 'e', created_at: T0, deleted_at: T1 })

//       await model.synchronizeAll()

//       assert.ok(!app.serverState.values['e'], 'server should no longer have the record')
//       const clientValue = await model.db.values.get('e')
//       assert.ok(!clientValue, 'Dexie should no longer have the record')
//    })

//    test('in-sync records produce no server writes', async () => {
//       const { app, model } = await setup(
//          { f: { uid: 'f', label: 'same' } },
//          { f: { uid: 'f', created_at: T0, updated_at: T1 } },
//       )

//       await model.db.values.add({ uid: 'f', label: 'same' })
//       await model.db.metadata.add({ uid: 'f', created_at: T0, updated_at: T1 })

//       // Spy on server mutations
//       let writes = 0
//       const orig = app.service('__any__')
//       const svc = app.service.bind(app)
//       app.service = (name) => {
//          const s = svc(name)
//          const origCreate = s.createWithMeta
//          const origUpdate = s.updateWithMeta
//          s.createWithMeta = (...a) => { writes++; return origCreate?.(...a) }
//          s.updateWithMeta = (...a) => { writes++; return origUpdate?.(...a) }
//          return s
//       }

//       await model.synchronizeAll()

//       assert.equal(writes, 0, 'no server writes expected for identical records')
//       const clientValue = await model.db.values.get('f')
//       assert.equal(clientValue.label, 'same')
//    })

//    test('where clause scopes sync: only matching records exchanged', async () => {
//       const { app, model } = await setup(
//          {
//             g1: { uid: 'g1', user_uid: 'u1', label: 'A' },
//             g2: { uid: 'g2', user_uid: 'u2', label: 'B' },
//          },
//          {
//             g1: { uid: 'g1', created_at: T0 },
//             g2: { uid: 'g2', created_at: T0 },
//          },
//       )

//       // Register scoped where clause and sync only for user u1
//       await model.addSynchroWhere({ user_uid: 'u1' })

//       // Manually call synchronize for this scoped where (synchronizeAll covers both)
//       const model2 = app.createOfflineModel(`test-${++dbCounter}`, ['label', 'user_uid'])
//       await model2.addSynchroWhere({ user_uid: 'u1' })
//       await model2.synchronizeAll()

//       const g1 = await model2.db.values.get('g1')
//       const g2 = await model2.db.values.get('g2')
//       assert.ok(g1, 'g1 (user u1) should have been synced')
//       assert.ok(!g2, 'g2 (user u2) should not have been synced')
//    })

//    test('mixed: pull + push + conflict resolved in one sync', async () => {
//       const { app, model } = await setup(
//          {
//             db:     { uid: 'db',     label: 'db-only' },
//             shared: { uid: 'shared', label: 'old' },
//          },
//          {
//             db:     { uid: 'db',     created_at: T0 },
//             shared: { uid: 'shared', created_at: T0, updated_at: T1 },
//          },
//       )

//       // Client has a local-only record and a newer version of shared
//       await model.db.values.add({ uid: 'local',  label: 'local-only' })
//       await model.db.metadata.add({ uid: 'local',  created_at: T1 })
//       await model.db.values.add({ uid: 'shared', label: 'new' })
//       await model.db.metadata.add({ uid: 'shared', created_at: T0, updated_at: T2 })

//       await model.synchronizeAll()

//       // db-only record pulled to client
//       const dbRec = await model.db.values.get('db')
//       assert.ok(dbRec)
//       assert.equal(dbRec.label, 'db-only')

//       // local-only record pushed to server
//       assert.ok(app.serverState.values['local'])
//       assert.equal(app.serverState.values['local'].label, 'local-only')

//       // client won conflict: server now has the new label
//       assert.equal(app.serverState.values['shared'].label, 'new')
//       const sharedRec = await model.db.values.get('shared')
//       assert.equal(sharedRec.label, 'new')
//    })

// })
