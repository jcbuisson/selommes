
let model;

export default function(app) {
   // ensures that a single model is ever created
   if (!model) model = app.createOfflineModel('range', ['user_uid', 'start', 'end']);
   // if (!model) model = app.createModel('range', 'uid', ['user_uid', 'start', 'end']);

   return { ...model }
}
