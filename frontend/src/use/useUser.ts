
import useElectricModel from './useElectricModel'

let model;

export default function(app) {
   if (!model) model = useElectricModel(app, 'user');
   return { ...model }
}
