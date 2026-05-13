import 'dotenv/config'
import express from 'express'
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';

import { expressX, reloadPlugin } from '@jcbuisson/express-x'
// import { expressX, reloadPlugin } from '#root/src/server.mjs'
// import { drizzleOfflinePlugin } from '@jcbuisson/express-x-drizzle'
import { drizzleOfflinePlugin } from '#root/src/drizzle-plugins.mjs'

// import authService from '#root/src/services/auth.service.js'
import publish from './publish.js'
import { metadata, user, range } from '#root/src/db/schema.js';

const app = expressX({
   WS_TRANSPORT: true,
   WS_PATH: '/selommes-socket-io/',
})

const db = drizzle(process.env.DATABASE_URL);

// add offline synchronization and database services for models 'user' and 'range'
app.configure(drizzleOfflinePlugin, db, metadata, [ user, range ])

// app.configure(authService);

// preserve socket data & rooms membership on page reload
app.configure(reloadPlugin)

// publish
// app.configure(publish)
// subscribe
app.on('connection', (socket) => {
   app.joinChannel('anonymous', socket)
})

// development only: serve static assets
app.use('/static', express.static('./static'))

const PORT = process.env.PORT || 3000
app.httpServer.listen(PORT, () => console.log(`App listening at http://localhost:${PORT}`))
