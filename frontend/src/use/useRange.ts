
let model;

export default function(app) {
   // ensures that a single model is ever created
   if (!model) model = app.createElectricModel('range');
   return { ...model }
}
