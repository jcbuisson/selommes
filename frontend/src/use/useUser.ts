
let model;

export default function(app) {
   if (!model) model = app.createElectricModel('user');
   return { ...model }
}