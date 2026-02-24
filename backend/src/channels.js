
// channels : 'students', 'teachers', ...'<student_uid>'

export default function(app) {

   async function roomsToPublish(context) {
      // 'find' events are not sent to anyone
      if (context.methodName.startsWith('find')) return [];
      
      return ['everyone']
   }

   app.service('user').publish(async (context) => {
      return await roomsToPublish(context);
   })

   app.service('selection').publish(async (context) => {
      return await roomsToPublish(context);
   })

}
