import { PGliteWorker } from '@electric-sql/pglite/worker'
import { BehaviorSubject, defer, switchMap } from 'rxjs'

let database: Promise<PGliteWorker> | undefined
let preparation: Promise<void> = Promise.resolve()

export default function useElectricModel(app: any, name: string) {
   database ??= PGliteWorker.create(
      new Worker(new URL('./electric.worker.ts', import.meta.url), { type: 'module' }),
      { dataDir: 'idb://selommes-sync' },
   )
   const ready = database.then(async db => {
      const channel = new BroadcastChannel(`selommes-sync-${name}`)
      let model: any
      const createModel = (ownsSync = false) => app.createElectricModel(name, {
         primaryKey: 'uid', localDb: db, channel, ownsSync,
      })
      model = createModel()
      // Serialize the shared schema initialization across models in this tab.
      preparation = preparation.then(() => model.prepare())
      await preparation
      model.start()
      const models = new BehaviorSubject(model)
      // PGlite's database election and Electric's stream ownership are separate.
      // A browser lock elects one sync owner per model and transfers on tab close.
      void navigator.locks.request(`selommes-electric-${name}`, async () => {
         model.stop()
         model = createModel(true)
         model.start()
         models.next(model)
         channel.postMessage({ modelName: name })
         await new Promise(() => {})
      })
      return { current: () => model, models }
   })

   const invoke = (method: string, ...args: any[]) => ready.then(({ current }) => current()[method](...args))
   return {
      getObservable: (where = {}) => defer(() => ready).pipe(
         switchMap(({ models }) => models.pipe(switchMap(model => model.getObservable(where)))),
      ),
      // Authentication needs an authoritative lookup before the initial Shape arrives.
      findMany: (where = {}) => navigator.onLine
         ? app.service(name).findMany({ ...where, deleted: false })
         : invoke('findMany', where),
      findUnique: async (where = {}) => {
         const rows = navigator.onLine
            ? await app.service(name).findMany({ ...where, deleted: false })
            : await invoke('findMany', where)
         return rows[0] ?? null
      },
      create: (data: any) => invoke('create', data),
      update: (uid: string, data: any) => invoke('update', uid, data),
      remove: (uid: string) => invoke('remove', uid),
      getStatus: () => invoke('getStatus'),
   }
}
