import 'dotenv/config'
import express from 'express'
import { expressX, reloadPlugin, offlinePlugin } from '@jcbuisson/express-x'
// import { expressX, reloadPlugin, offlinePlugin } from '#root/src/server.mjs'

import publish from './publish.js'
import prisma from './prisma.js'


const app = expressX({
   WS_TRANSPORT: true,
   WS_PATH: '/selommes-socket-io/',
})

app.set('prisma', prisma)

// allows socket data & room transfer on page reload
app.configure(reloadPlugin)

// add offline synchronization service and add database services for models 'user' and 'selection'
app.configure(offlinePlugin, ['user', 'selection'])

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
