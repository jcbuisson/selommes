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


// Each test gets a unique Dexie database name so instances never collide
let dbCounter = 0

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

   test('record only on client, deleted → ignored on both sides', async () => {
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
      // A record that was created and deleted locally, never reached the server
      await model.db.values.add({ uid: 'd1', label: 'Gone', __deleted__: true })
      await model.db.metadata.add({ uid: 'd1', created_at: T0, deleted_at: T1 })
      await model.addSynchroWhere({})
      await model.synchronizeAll()

      // Server should not have received it (was already deleted before ever syncing)
      assert.ok(!serverValues['d1'], 'server should not have the deleted-only record')
      // Client Dexie entry should be cleaned up
      const d1 = await model.db.values.get('d1')
      assert.ok(!d1, 'Dexie should no longer hold the deleted record')
   })

   test('record in both, client newer → server is updated via socket', async () => {
      const { clientSocket, serverSocket, triggerConnect } = createMockSocketPair()

      const modelName    = `sock-${++dbCounter}`
      const serverValues = { u1: { uid: 'u1', label: 'old' } }
      const serverMeta   = { u1: { uid: 'u1', created_at: T0, updated_at: T1 } }

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
         findUnique:     async () => null,
         createWithMeta: async () => {},
         updateWithMeta: async (uid, data, updated_at) => {
            if (serverValues[uid]) Object.assign(serverValues[uid], data)
            if (serverMeta[uid])   serverMeta[uid].updated_at = updated_at
         },
      })

      const clientApp = createClient(clientSocket, { debug: false })
      offlinePlugin(clientApp)
      triggerConnect()

      const model = clientApp.createOfflineModel(modelName, ['label'])
      await model.db.values.add({ uid: 'u1', label: 'new' })
      await model.db.metadata.add({ uid: 'u1', created_at: T0, updated_at: T2 })
      await model.addSynchroWhere({})
      await model.synchronizeAll()

      assert.equal(serverValues['u1'].label, 'new', 'server should have the updated label')
      const clientValue = await model.db.values.get('u1')
      assert.equal(clientValue.label, 'new', 'client Dexie should be unchanged')
   })

})
