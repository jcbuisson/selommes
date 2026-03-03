
let model;

export default function(app) {
   if (!model) model = app.createOfflineModel('selection', ['userId', 'start', 'end']);

   return { ...model }
}