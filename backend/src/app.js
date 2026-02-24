import 'dotenv/config'
import express from 'express'
import { expressX } from '@jcbuisson/express-x'

import services from './services/index.js'
import channels from './channels.js'
import transfer from './transfer.js'

import prisma from './prisma.js'


const app = expressX({
   WS_TRANSPORT: true,
   WS_PATH: '/selommes-socket-io/',
})

app.set('prisma', prisma)

// services
app.configure(services)

// development only: serve static assets (reports, avatars)
app.use('/static', express.static('./static'))

// pub/sub
app.configure(channels)

// cnx transfer
app.configure(transfer)

const PORT = process.env.PORT || 3000
app.httpServer.listen(PORT, () => console.log(`App listening at http://localhost:${PORT}`))
