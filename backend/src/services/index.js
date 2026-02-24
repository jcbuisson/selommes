
// database services
import metadataService from './database/metadata/metadata.service.js'

import userService from './database/user/user.service.js'
import selectionService from './database/selection/selection.service.js'

// custom services
import syncService from './custom/sync/sync.service.js'


export default function (app) {
   // add database services
   app.configure(metadataService)

   app.configure(userService)
   app.configure(selectionService)

   // add custom services
   app.configure(syncService)
}
