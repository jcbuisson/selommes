
let model;

export default function(app) {
   if (!model) model = app.createOfflineModel('range', ['userId', 'start', 'end']);

   return { ...model }
}