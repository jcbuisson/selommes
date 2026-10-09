
export default function useElectricModel(app: any, name: string) {

   const model = app.createElectricModel(name, { primaryKey: 'uid' })

   // Authentication needs an authoritative lookup before the initial Shape arrives.
   const findMany = (where = {}) => navigator.onLine
      ? app.service(name).findMany({ ...where, deleted: false })
      : model.findMany(where)

   return {
      ...model,
      findMany,
      findUnique: async (where = {}) => (await findMany(where))[0] ?? null,
   }
}
