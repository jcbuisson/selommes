
import useElectricModel from './useElectricModel'

let model;

export default function(app) {
   // ensures that a single model is ever created
   if (!model) model = useElectricModel(app, 'range');
   return { ...model }
}
