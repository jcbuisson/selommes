// Must be imported before Dexie so it patches globalThis.indexedDB first
import 'fake-indexeddb/auto'

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { io as ioc } from 'socket.io-client'

import { createClient, offlinePlugin } from '../../frontend/src/client.mts'
import { expressX } from '#root/src/server.mjs'
import { runSync } from '#root/src/drizzle-plugins.mjs'

const T0 = new Date('2026-01-01T00:00:00Z')
const T1 = new Date('2026-01-02T00:00:00Z')
const T2 = new Date('2026-01-03T00:00:00Z')

function matchesWhere(value, where) {
   return Object.entries(where).every(([k, v]) => value[k] === v)
}

let dbCounter = 0

// ─── Test context helper ───────────────────────────────────────────────────────
// Starts a real expressX server, connects a real socket.io client, and wires up
// createClient (+ optionally offlinePlugin). Returns cleanup().

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

   return { serverApp, clientApp, cleanup }
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
      const modelName    = `sock-${++dbCounter}`
      const serverValues = { r1: { uid: 'r1', label: 'Vacances' } }
      const serverMeta   = { r1: { uid: 'r1', created_at: T0 } }

      const { clientApp, cleanup } = await createTestContext(serverApp => {
         serverApp.createService('sync', {
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
         serverApp.createService(modelName, {
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
      }, { useOfflinePlugin: true })

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
      const modelName    = `sock-${++dbCounter}`
      const serverValues = {}
      const serverMeta   = {}

      const { clientApp, cleanup } = await createTestContext(serverApp => {
         serverApp.createService('sync', {
            go: async (mn, where, _cutoff, clientMetadataDict) =>
               runSync({}, clientMetadataDict, () => Promise.resolve(null), async () => {}),
         })
         serverApp.createService(modelName, {
            findUnique:     async () => null,
            createWithMeta: async (uid, data, created_at) => {
               serverValues[uid] = { uid, ...data }
               serverMeta[uid]   = { uid, created_at }
            },
            updateWithMeta: async () => {},
         })
      }, { useOfflinePlugin: true })

      try {
         const model = clientApp.createOfflineModel(modelName, ['label'])
         await model.db.values.add({ uid: 'x1', label: 'Formation' })
         await model.db.metadata.add({ uid: 'x1', created_at: T1 })
         await model.addSynchroWhere({})
         await model.synchronizeAll()

         assert.ok(serverValues['x1'], 'server should have received the pushed record')
         assert.equal(serverValues['x1'].label, 'Formation')
      } finally {
         await cleanup()
      }
   })

   test('record only on client, deleted → ignored on both sides', async () => {
      const modelName    = `sock-${++dbCounter}`
      const serverValues = {}

      const { clientApp, cleanup } = await createTestContext(serverApp => {
         serverApp.createService('sync', {
            go: async (mn, where, _cutoff, clientMetadataDict) =>
               runSync({}, clientMetadataDict, () => Promise.resolve(null), async () => {}),
         })
         serverApp.createService(modelName, {
            findUnique:     async () => null,
            createWithMeta: async (uid, data, created_at) => { serverValues[uid] = { uid, ...data } },
            updateWithMeta: async () => {},
         })
      }, { useOfflinePlugin: true })

      try {
         const model = clientApp.createOfflineModel(modelName, ['label'])
         await model.db.values.add({ uid: 'd1', label: 'Gone', __deleted__: true })
         await model.db.metadata.add({ uid: 'd1', created_at: T0, deleted_at: T1 })
         await model.addSynchroWhere({})
         await model.synchronizeAll()

         assert.ok(!serverValues['d1'], 'server should not have the deleted-only record')
         const d1 = await model.db.values.get('d1')
         assert.ok(!d1, 'Dexie should no longer hold the deleted record')
      } finally {
         await cleanup()
      }
   })

   test('record in both, client newer → server is updated via socket', async () => {
      const modelName    = `sock-${++dbCounter}`
      const serverValues = { u1: { uid: 'u1', label: 'old' } }
      const serverMeta   = { u1: { uid: 'u1', created_at: T0, updated_at: T1 } }

      const { clientApp, cleanup } = await createTestContext(serverApp => {
         serverApp.createService('sync', {
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
         serverApp.createService(modelName, {
            findUnique:     async () => null,
            createWithMeta: async () => {},
            updateWithMeta: async (uid, data, updated_at) => {
               if (serverValues[uid]) Object.assign(serverValues[uid], data)
               if (serverMeta[uid])   serverMeta[uid].updated_at = updated_at
            },
         })
      }, { useOfflinePlugin: true })

      try {
         const model = clientApp.createOfflineModel(modelName, ['label'])
         await model.db.values.add({ uid: 'u1', label: 'new' })
         await model.db.metadata.add({ uid: 'u1', created_at: T0, updated_at: T2 })
         await model.addSynchroWhere({})
         await model.synchronizeAll()

         assert.equal(serverValues['u1'].label, 'new', 'server should have the updated label')
         const clientValue = await model.db.values.get('u1')
         assert.equal(clientValue.label, 'new', 'client Dexie should be unchanged')
      } finally {
         await cleanup()
      }
   })

})
