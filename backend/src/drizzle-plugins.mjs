import express from "express"
import { createServer } from "http"
import { Server } from "socket.io"
import bcrypt from 'bcryptjs'

import { and, eq, getTableName } from "drizzle-orm";

import { metadata } from '#root/src/db/schema.js';
import { Mutex, truncateString } from '@jcbuisson/express-x'


//////////////////////////       UTILITIES       //////////////////////////

function whereToDrizzleFilters(table, where) {
   const conditions = Object.entries(where)
      .filter(([_, value]) => value !== undefined)
      .map(([key, value]) => eq(table[key], value));
   return conditions.length ? and(...conditions) : undefined;
}


// DOIT FAIRE UN ROLLBACK EN CAS D'ERREUR SERVEUR (EX: ERREUR SÉMANTIQUE TYPE PB CLÉ ÉTRANGÈRE OU AUTRE)


//////////////////////////       SYNC ALGORITHM (pure, exported for testing)       //////////////////////////

export function computeSyncResult(databaseValuesDict, clientMetadataDict, databaseMetadataDict) {
   const onlyDatabaseIds = new Set()
   const onlyClientIds = new Set()
   const databaseAndClientIds = new Set()

   for (const uid in databaseValuesDict) {
      if (uid in clientMetadataDict) databaseAndClientIds.add(uid)
      else onlyDatabaseIds.add(uid)
   }
   for (const uid in clientMetadataDict) {
      if (uid in databaseValuesDict) databaseAndClientIds.add(uid)
      else onlyClientIds.add(uid)
   }

   const addDatabase = [], updateDatabase = [], deleteDatabase = []
   const addClient = [], updateClient = [], deleteClient = []

   for (const uid of onlyDatabaseIds) {
      const databaseMetaData = databaseMetadataDict[uid] || { uid, created_at: new Date() }
      addClient.push([databaseValuesDict[uid], databaseMetaData])
   }

   for (const uid of onlyClientIds) {
      const clientMetaData = clientMetadataDict[uid]
      if (clientMetaData.deleted_at) {
         deleteClient.push([uid, clientMetaData.deleted_at])
      } else {
         addDatabase.push(clientMetaData)
      }
   }

   for (const uid of databaseAndClientIds) {
      const clientMetaData = clientMetadataDict[uid]
      if (clientMetaData.deleted_at) {
         deleteDatabase.push(uid)
         deleteClient.push([uid, clientMetaData.deleted_at])
      } else {
         const databaseMetaData = databaseMetadataDict[uid] || { uid, created_at: new Date() }
         const clientUpdatedAt = new Date(clientMetaData.updated_at || clientMetaData.created_at)
         const databaseUpdatedAt = new Date(databaseMetaData.updated_at || databaseMetaData.created_at)
         const diff = clientUpdatedAt - databaseUpdatedAt
         if (diff > 0) updateDatabase.push(clientMetaData)
         else if (diff < 0) updateClient.push([databaseValuesDict[uid], databaseMetaData])
      }
   }

   return {
      addClient,
      updateClient,
      deleteClient,
      addDatabase,
      updateDatabase,
      deleteDatabase,
   }
}

//////////////////////////       DRIZZLE OFFLINE PLUGIN       //////////////////////////

export function drizzleOfflinePlugin(app, db, metadata, models) {

   // add a database service for each model
   for (const model of models) {
      const modelName = getTableName(model)

      app.createService(modelName, {

         findUnique: async (where) => {
            const rows = await db.select().from(model).where(whereToDrizzleFilters(model, where));
            return rows[0] ?? null;
         },

         findMany: async (where) => {
            return await db.select().from(model).where(whereToDrizzleFilters(model, where));
         },
         
         createWithMeta: async (uid, data, created_at) => {
            const ts = new Date(created_at)
            return await db.transaction(async (tx) => {
               const value = await tx.insert(model).values({ uid, ...data }).returning();
               // Upsert: if a metadata row already exists (left over from a previous
               // deleteWithMeta which hard-deletes the model row but keeps metadata),
               // clear deleted_at/updated_at so the record is active again.
               const meta = await tx.insert(metadata)
                  .values({ uid, created_at: ts })
                  .onConflictDoUpdate({
                     target: metadata.uid,
                     set: { created_at: ts, deleted_at: null, updated_at: null },
                  })
                  .returning();
               return [value, meta]
            })
         },

         updateWithMeta: async (uid, data, updated_at) => {
            return await db.transaction(async (tx) => {
               const value = await tx.update(model).set(data).where(eq(model.uid, uid)).returning();
               const meta = await tx.update(metadata).set({ updated_at: new Date(updated_at) }).where(eq(metadata.uid, uid)).returning();
               return [value, meta]
            })
         },

         deleteWithMeta: async (uid, deleted_at) => {
            return await db.transaction(async (tx) => {
               const value = await tx.delete(model).where(eq(model.uid, uid)).returning();
               const meta = await tx.update(metadata).set({ deleted_at: new Date(deleted_at) }).where(eq(metadata.uid, uid)).returning();
               return [value, meta]
            })
         },
      })
   }

   const syncMutexes = new Map()

   // add a synchronization service
   app.createService('sync', {

      // CUTOFFDATE INUTILE ?
      go: async (modelName, where, cutoffDate, clientMetadataDict) => {

         // get or create a mutex specific to modelName + where
         const mutexKey = `${modelName}:${JSON.stringify(Object.fromEntries(Object.entries(where).sort()))}`
         if (!syncMutexes.has(mutexKey)) syncMutexes.set(mutexKey, new Mutex())
         // acquire it: no other sync operation from another client on this model+where can occur in parallel
         await syncMutexes.get(mutexKey).acquire()

         try {
            console.log('>>>>> SYNC', modelName, where, cutoffDate)
            const databaseService = app.service(modelName)
      
            // STEP1: get existing database `where` values and build a dictionary
            const databaseValues = await databaseService.findMany(where)
            const databaseValuesDict = databaseValues.reduce((accu, value) => {
               accu[value.uid] = value
               return accu
            }, {})

            // STEP 2: fetch metadata for each database record
            const databaseMetadataDict = {}
            for (const uid of Object.keys(databaseValuesDict)) {
               const meta = (await db.select().from(metadata).where(eq(metadata.uid, uid)))[0] ?? null
               if (meta) databaseMetadataDict[uid] = meta
            }

            // STEP 3: compute sync result
            const result = computeSyncResult(databaseValuesDict, clientMetadataDict, databaseMetadataDict)

            // STEP 4: execute server-side deletions
            for (const uid of result.deleteDatabase) {
               await databaseService.deleteWithMeta(uid, clientMetadataDict[uid].deleted_at)
            }

            console.log('addDatabase', truncateString(JSON.stringify(result.addDatabase)))
            console.log('updateDatabase', truncateString(JSON.stringify(result.updateDatabase)))
            console.log('addClient', truncateString(JSON.stringify(result.addClient)))
            console.log('deleteClient', truncateString(JSON.stringify(result.deleteClient)))
            console.log('updateClient', truncateString(JSON.stringify(result.updateClient)))

            return result
         } catch(err) {
            console.log('*** err sync', err)
         } finally {
            syncMutexes.get(mutexKey).release()
         }
      },
   })

}
