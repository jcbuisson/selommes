import 'dotenv/config'
import express from 'express'
import pg from 'pg'

import { expressX } from '@jcbuisson/express-x/server'
import { electricOfflinePlugin } from '@jcbuisson/express-x-plugins/electric-server'
import { reloadPlugin } from '@jcbuisson/express-x-plugins/reload-server'

import mailService from '#root/src/mail.service.js'

// import authService from '#root/src/services/auth.service.js'
import publish from '#root/src/publish.js'


const app = expressX({
   WS_TRANSPORT: true,
   WS_PATH: '/selommes-socket-io/',
})

const { Pool } = pg
const db = new Pool({ connectionString: process.env.DATABASE_URL })

app.configure(electricOfflinePlugin, db, ['user', 'range'], {
   // ElectricSQL sync service
   electricUrl: process.env.ELECTRIC_URL,
   // Development-only: add real session/ownership checks in production
   authorize: async () => true,
})

// app.configure(authService);
app.configure(mailService)

// preserve socket data & rooms membership on page reload
app.configure(reloadPlugin)

// publish
app.configure(publish)
// subscribe
app.on('connection', (socket) => {
   app.joinChannel('anonymous', socket)
})

// development only: serve static assets
// app.use('/static', express.static('./static'))

const PORT = process.env.PORT
app.httpServer.listen(PORT, () => console.log(`App listening at http://localhost:${PORT}`))
