import 'dotenv/config'
import express from 'express'
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';

// import { expressX, reloadPlugin, offlinePlugin } from '@jcbuisson/express-x'
import { expressX, reloadPlugin, drizzleOfflinePlugin } from '#root/src/server.mjs'

import publish from './publish.js'
import { userTable, rangeTable, metadataTable } from './src/db/schema.js';

const app = expressX({
   WS_TRANSPORT: true,
   WS_PATH: '/selommes-socket-io/',
})

const db = drizzle(process.env.DATABASE_URL);

// allows socket data & room transfer on page reload
app.configure(reloadPlugin)

// add offline synchronization service and add database services for models 'user' and 'selection'
app.configure(drizzleOfflinePlugin, db, ['user', 'selection'])

// publish
app.configure(publish)
// subscribe
app.on('connection', (socket) => {
   app.joinChannel('anonymous', socket)
})

// development only: serve static assets
app.use('/static', express.static('./static'))

const PORT = process.env.PORT || 3000
app.httpServer.listen(PORT, () => console.log(`App listening at http://localhost:${PORT}`))
