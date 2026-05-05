import express from "express"
import { createServer } from "http"
import { Server } from "socket.io"
import bcrypt from 'bcryptjs'

import { metadata } from '#root/src/db/schema.js';
import { and, eq, getTableName } from "drizzle-orm";

//////////////////////////       UTILITIES       //////////////////////////

class Mutex {
   constructor() {
      this.locked = false;
      this.queue = [];
   }

   async acquire() {
      if (this.locked) {
         return new Promise(resolve => this.queue.push(resolve));
      }
      this.locked = true;
   }

   release() {
      if (this.queue.length > 0) {
         const next = this.queue.shift();
         next();
      } else {
         this.locked = false;
      }
   }
}

function objectToWhere(table, filters) {
   const conditions = Object.entries(filters)
      .filter(([_, value]) => value !== undefined)
      .map(([key, value]) => eq(table[key], value));
   return conditions.length ? and(...conditions) : undefined;
}

function truncateString(str, maxLength = 300, ellipsis = '...') {
   // Check if the string already fits
   if (str.length <= maxLength) {
      return str;
   }

   // Calculate the cut-off point, accounting for the ellipsis length
   const cutLength = maxLength - ellipsis.length;
   
   // Ensure the string is long enough to be cut
   if (cutLength < 0) {
         return str.substring(0, maxLength); // Just cut it off if ellipsis doesn't fit
   }

   // Truncate the string and add the ellipsis
   return str.substring(0, cutLength) + ellipsis;
}

//////////////////////////       DRIZZLE OFFLINE PLUGIN       //////////////////////////

const mutex = new Mutex()

export function drizzleOfflinePlugin(app, db, models) {

   // add a database service for each model
   for (const model of models) {
      const modelName = getTableName(model)

      app.createService(modelName, {

         findUnique: async (where) => {
            const rows = await db.select().from(model).where(objectToWhere(model, where));
            return rows[0] ?? null;
         },

         findMany: async (where) => {
            return await db.select().from(model).where(objectToWhere(model, where));
         },
         
         createWithMeta: async (uid, data, created_at) => {
            db.transaction(async (tx) => {
               const value = await tx.insert(model).values({ uid, ...data }).returning();
               const meta = await tx.insert(metadata).values({ uid, created_at }).returning();
               return [value, meta]
            })
         },
         
         updateWithMeta: async (uid, data, updated_at) => {
            db.transaction(async (tx) => {
               const value = await tx.update(model).values(data).where(eq(model.uid, uid)).returning();
               const meta = await tx.update(metadata).set({ updated_at }).where(eq(metadata.uid, uid)).returning();
               return [value, meta]
            })
         },
         
         deleteWithMeta: async (uid, deleted_at) => {
            db.transaction(async (tx) => {
               const value = await tx.delete(model).where(eq(model.uid, uid)).returning();
               const meta = await tx.update(metadata).set({ deleted_at }).where(eq(metadata.uid, uid)).returning();
               return [value, meta]
            })
         },
      })
   }

   // add a synchronization service
   app.createService('sync', {

      // AMÉLIORER : ne pas avoir une exclusion mutuelle globale, mais seulement par model/where
      go: async (modelName, where, cutoffDate, clientMetadataDict) => {
         await mutex.acquire()
         try {
            console.log('>>>>> SYNC', modelName, where, cutoffDate)
            const databaseService = app.service(modelName)
      
            // STEP 1: get existing database `where` values
            const databaseValues = await databaseService.findMany(where)
         
            const databaseValuesDict = databaseValues.reduce((accu, value) => {
               accu[value.uid] = value
               return accu
            }, {})
            // console.log('clientMetadataDict', clientMetadataDict)
            // console.log('databaseValuesDict', databaseValuesDict)
         
            // STEP 2: compute intersections between client and database uids
            const onlyDatabaseIds = new Set()
            const onlyClientIds = new Set()
            const databaseAndClientIds = new Set()
         
            for (const uid in databaseValuesDict) {
               if (uid in clientMetadataDict) {
                  databaseAndClientIds.add(uid)
               } else {
                  onlyDatabaseIds.add(uid)
               }
            }
         
            for (const uid in clientMetadataDict) {
               if (uid in databaseValuesDict) {
                  databaseAndClientIds.add(uid)
               } else {
                  onlyClientIds.add(uid)
               }
            }
            // console.log('onlyDatabaseIds', onlyDatabaseIds)
            // console.log('onlyClientIds', onlyClientIds)
            // console.log('databaseAndClientIds', databaseAndClientIds)
         
            // STEP 3: build add/update/delete sets
            const addDatabase = []
            const updateDatabase = []
            const deleteDatabase = []
         
            const addClient = []
            const updateClient = []
            const deleteClient = []
         
            for (const uid of onlyDatabaseIds) {
               const databaseValue = databaseValuesDict[uid]
               const databaseMetaData = (await db.select().from(metadata).where(eq(metadata.uid, uid)))[0]
                  || { uid, created_at: new Date() } // should not happen
               addClient.push([databaseValue, databaseMetaData])
            }
         
            for (const uid of onlyClientIds) {
               const clientMetaData = clientMetadataDict[uid]
               if (clientMetaData.deleted_at) {
                  deleteClient.push([uid, clientMetaData.deleted_at])
               } else if (new Date(clientMetaData.created_at) > cutoffDate) {
                  addDatabase.push(clientMetaData)
               } else {
                  // ???
               }
            }
         
            for (const uid of databaseAndClientIds) {
               const databaseValue = databaseValuesDict[uid]
               const clientMetaData = clientMetadataDict[uid]
                  || { uid, created_at: new Date() } // should not happen
               if (clientMetaData.deleted_at) {
                  deleteDatabase.push(uid)
                  deleteClient.push([uid, clientMetaData.deleted_at])
               } else {
                  const databaseMetaData = (await db.select().from(metadata).where(eq(metadata.uid, uid)))[0]
                     || { uid, created_at: new Date() } // should not happen
                  const clientUpdatedAt = new Date(clientMetaData.updated_at || clientMetaData.created_at)
                  const databaseUpdatedAt = new Date(databaseMetaData.updated_at || databaseMetaData.created_at)
                  const dateDifference = clientUpdatedAt - databaseUpdatedAt
                  // console.log('databaseMetaData', databaseMetaData, 'clientMetaData', clientMetaData, 'dateDifference', dateDifference)
                  if (dateDifference > 0) {
                     updateDatabase.push(clientMetaData)
                  } else if (dateDifference < 0) {
                     updateClient.push(databaseValue)
                  }
               }
            }
            console.log('addDatabase', truncateString(JSON.stringify(addDatabase)))
            console.log('deleteDatabase', truncateString(JSON.stringify(deleteDatabase)))
            console.log('updateDatabase', truncateString(JSON.stringify(updateDatabase)))
         
            console.log('addClient', truncateString(JSON.stringify(addClient)))
            console.log('deleteClient', truncateString(JSON.stringify(deleteClient)))
            console.log('updateClient', truncateString(JSON.stringify(updateClient)))
         
            // STEP4: execute database deletions
            for (const uid of deleteDatabase) {
               const clientMetaData = clientMetadataDict[uid]
               // console.log('---delete', uid, clientMetaData)
               await databaseService.deleteWithMeta(uid, clientMetaData.deleted_at)
            }
         
            // STEP5: return to client the changes to perform on its cache, and create/update to perform on database with full data
            // database creations & updates are done later by the client with complete data (this function only has client values's meta-data)
            return {
               toAdd: addClient,
               toUpdate: updateClient,
               toDelete: deleteClient,

               addDatabase,
               updateDatabase,
            }
         } catch(err) {
            console.log('*** err sync', err)
         } finally {
            mutex.release()
         }
      },
   })

}

