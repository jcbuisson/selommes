import 'dotenv/config'
import express from 'express'
import nodemailer from 'nodemailer'
import { handleMutateRequest, handleQueryRequest } from '@rocicorp/zero/server'
import { mustGetMutator, mustGetQuery } from '@rocicorp/zero'
import { dbProvider } from './zero/db-provider.js'
import { mutators } from './zero/mutators.js'
import { queries } from './zero/queries.js'
import { schema } from './zero/schema.js'
import { eq } from 'drizzle-orm'
import { range, user } from './db/schema.js'
import { drizzleClient } from './zero/db-provider.js'

const app = express()
app.use(express.json({ limit: '1mb' }))

function toFetchRequest(req) {
   const url = new URL(req.originalUrl, `${req.protocol}://${req.get('host')}`)
   return new Request(url, {
      method: req.method,
      headers: req.headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : JSON.stringify(req.body),
   })
}

app.post('/api/zero/query', async (req, res, next) => {
   try {
      const result = await handleQueryRequest({
         handler: (name, args) => mustGetQuery(queries, name).fn({ args }),
         schema,
         request: toFetchRequest(req),
         userID: null,
      })
      res.json(result)
   } catch (error) { next(error) }
})

app.post('/api/zero/mutate', async (req, res, next) => {
   try {
      const result = await handleMutateRequest({
         dbProvider,
         handler: transact => transact((tx, name, args) => mustGetMutator(mutators, name).fn({ tx, args })),
         request: toFetchRequest(req),
         userID: null,
      })
      res.json(result)
   } catch (error) { next(error) }
})

app.post('/api/mail', async (req, res, next) => {
   try {
      const transporter = nodemailer.createTransport({
         host: process.env.MAIL_HOST,
         port: Number(process.env.MAIL_PORT),
         secure: false,
         auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASSWORD },
         name: process.env.MAIL_DOMAIN,
      })
      const result = await transporter.sendMail({ from: process.env.MAIL_SENDER, ...req.body })
      res.json(result)
   } catch (error) { next(error) }
})

for (const [name, table] of Object.entries({ user, range })) {
   app.get(`/api/${name}`, async (_req, res, next) => {
      try { res.json(await drizzleClient.select().from(table)) } catch (error) { next(error) }
   })
   app.get(`/api/${name}/:uid`, async (req, res, next) => {
      try {
         const [row] = await drizzleClient.select().from(table).where(eq(table.uid, req.params.uid)).limit(1)
         if (!row) return res.sendStatus(404)
         res.json(row)
      } catch (error) { next(error) }
   })
   app.post(`/api/${name}`, async (req, res, next) => {
      try { res.status(201).json((await drizzleClient.insert(table).values(req.body).returning())[0]) } catch (error) { next(error) }
   })
   app.put(`/api/${name}/:uid`, async (req, res, next) => {
      try {
         const [row] = await drizzleClient.update(table).set(req.body).where(eq(table.uid, req.params.uid)).returning()
         if (!row) return res.sendStatus(404)
         res.json(row)
      } catch (error) { next(error) }
   })
   app.delete(`/api/${name}/:uid`, async (req, res, next) => {
      try {
         const [row] = await drizzleClient.delete(table).where(eq(table.uid, req.params.uid)).returning()
         if (!row) return res.sendStatus(404)
         res.json(row)
      } catch (error) { next(error) }
   })
}

app.use((error, _req, res, _next) => {
   console.error(error)
   res.status(500).json({ error: error.message })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`API listening at http://localhost:${PORT}`))
