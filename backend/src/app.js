import 'dotenv/config'
import express from 'express'
import pg from 'pg'

import { expressX } from '@jcbuisson/express-x/server'
import { electricServerPlugin, prepareElectricSyncSchema } from '@jcbuisson/express-x-plugins/electric-server'
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

const models = [
   { name: 'user', primaryKey: 'uid', tombstoneData: { email: null, name: '', color: '' } },
   { name: 'range', primaryKey: 'uid', tombstoneData: { start: '', end: '', label: '', color: '', user_uid: null } },
]

await prepareElectricSyncSchema(db, models)
// Deleted users release their unique email while active users still require one.
await db.query(`ALTER TABLE "user" ALTER COLUMN email DROP NOT NULL`)
await db.query(`DO $$ BEGIN
   IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"user"'::regclass AND conname = 'user_active_email_required') THEN
      ALTER TABLE "user" ADD CONSTRAINT user_active_email_required CHECK (deleted OR email IS NOT NULL);
   END IF;
END $$`)

app.configure(electricServerPlugin, db, models, {
   sync: true,
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
