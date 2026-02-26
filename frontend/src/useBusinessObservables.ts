import { useUser } from '/src/use/useUser'


export function useBusinessObservables(app) {

   const { getObservable: users$, update: updateUser, delete: deleteUser } = useUser(app)


   function guardCombineLatest(observables) {
      if (observables.length === 0) {
         // If the array is empty, immediately return an Observable that emits an empty array
         return of([])
      } else {
         // Otherwise, proceed with combineLatest
         return combineLatest(observables)
      }
   }

   function user$(uid: string) {
      return users$({ uid }).pipe(
         filter(list => list?.length > 0),
         map(list => list[0]),
      )
   }

   return {
      guardCombineLatest,
      user$,
   }
}
