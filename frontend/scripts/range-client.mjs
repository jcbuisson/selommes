#!/usr/bin/env node

import { randomUUID } from 'node:crypto'
import { io } from 'socket.io-client'
import { createClient } from '@jcbuisson/express-x-client'

const DEFAULT_URL = process.env.SELOMMES_URL || 'http://localhost:3000'
const DEFAULT_PATH = process.env.SELOMMES_SOCKET_PATH || '/selommes-socket-io/'
const DEFAULT_TOKEN = process.env.SELOMMES_TOKEN || 'mytoken'

const command = process.argv[2]
let options

try {
   options = parseArgs(process.argv.slice(3))
} catch (error) {
   console.error(error?.message || error)
   printHelp()
   process.exit(1)
}

if (!command || command === '--help' || command === '-h' || options.help) {
   printHelp()
   process.exit(command ? 0 : 1)
}

if (!['create', 'edit', 'update', 'delete', 'remove'].includes(command)) {
   console.error(`Unknown command: ${command}`)
   printHelp()
   process.exit(1)
}

try {
   validateCommandOptions()
} catch (error) {
   console.error(error?.message || error)
   process.exit(1)
}

const socket = io(options.url || DEFAULT_URL, {
   path: options.path || DEFAULT_PATH,
   transports: ['websocket'],
   extraHeaders: {
      'bearer-token': options.token || DEFAULT_TOKEN,
   },
})

const app = createClient(socket, { debug: Boolean(options.verbose) })
const timeout = Number(options.timeout || 20000)

try {
   await waitForConnect(socket, timeout)

   if (command === 'create') {
      printResult(await createRange())
   } else if (command === 'edit' || command === 'update') {
      printResult(await editRange())
   } else if (command === 'delete' || command === 'remove') {
      printResult(await deleteRange())
   } else {
      throw new Error(`Unknown command: ${command}`)
   }
} catch (error) {
   console.error(error?.message || error)
   process.exitCode = 1
} finally {
   socket.disconnect()
}

async function createRange() {
   const userUid = options['user-uid']
   const start = parseDateOption('start')
   const end = parseDateOption('end')

   const user = await app.service('user', { timeout }).findUnique({ uid: userUid })

   if (!user) throw new Error(`User not found: ${userUid}`)

   const uid = options.uid || randomUUID()
   const data = {
      user_uid: user.uid,
      label: options.label || user.name,
      color: options.color || user.color,
      start,
      end,
   }

   return app.service('range', { timeout }).createWithMeta(uid, data, new Date().toISOString())
}

async function editRange() {
   const uid = options.uid
   const existing = await app.service('range', { timeout }).findUnique({ uid })
   if (!existing) throw new Error(`Range not found: ${uid}`)

   if (options['user-uid']) {
      const user = await app.service('user', { timeout }).findUnique({ uid: options['user-uid'] })
      if (!user) throw new Error(`User not found: ${options['user-uid']}`)
   }

   const data = {
      user_uid: options['user-uid'] || existing.user_uid,
      label: options.label || existing.label,
      color: options.color || existing.color,
      start: options.start ? parseDateOption('start') : existing.start,
      end: options.end ? parseDateOption('end') : existing.end,
   }
   ensureChronologicalRange(data.start, data.end)

   return app.service('range', { timeout }).updateWithMeta(uid, data, new Date().toISOString())
}

async function deleteRange() {
   return app.service('range', { timeout }).deleteWithMeta(options.uid, new Date().toISOString())
}

function waitForConnect(socket, timeoutMs) {
   if (socket.connected) return Promise.resolve()

   return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
         cleanup()
         reject(new Error(`Socket connection timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      function cleanup() {
         clearTimeout(timer)
         socket.off('connect', onConnect)
         socket.off('connect_error', onError)
      }

      function onConnect() {
         cleanup()
         resolve()
      }

      function onError(error) {
         cleanup()
         reject(error)
      }

      socket.once('connect', onConnect)
      socket.once('connect_error', onError)
   })
}

function parseArgs(args) {
   const parsed = {}

   for (let i = 0; i < args.length; i++) {
      const arg = args[i]
      if (!arg.startsWith('--')) {
         throw new Error(`Unexpected argument: ${arg}`)
      }

      const raw = arg.slice(2)
      const eqIndex = raw.indexOf('=')
      if (eqIndex >= 0) {
         parsed[raw.slice(0, eqIndex)] = raw.slice(eqIndex + 1)
         continue
      }

      const next = args[i + 1]
      if (!next || next.startsWith('--')) {
         parsed[raw] = true
      } else {
         parsed[raw] = next
         i++
      }
   }

   return parsed
}

function requireOption(name) {
   const value = options[name]
   if (!value) throw new Error(`Missing required option: --${name}`)
   return value
}

function requireDateOption(name) {
   requireOption(name)
   return parseDateOption(name)
}

function validateCommandOptions() {
   if (command === 'create') {
      const start = requireDateOption('start')
      const end = requireDateOption('end')
      requireOption('user-uid')
      ensureChronologicalRange(start, end)
      return
   }

   if (command === 'edit' || command === 'update') {
      requireOption('uid')
      if (!hasAnyOption(['user-uid', 'start', 'end', 'label', 'color'])) {
         throw new Error('Missing update data: provide at least one of --user-uid, --start, --end, --label, or --color')
      }
      if (options.start) parseDateOption('start')
      if (options.end) parseDateOption('end')
      if (options.start && options.end) {
         ensureChronologicalRange(parseDateOption('start'), parseDateOption('end'))
      }
      return
   }

   requireOption('uid')
}

function hasAnyOption(names) {
   return names.some(name => options[name] !== undefined)
}

function ensureChronologicalRange(start, end) {
   if (new Date(end).getTime() < new Date(start).getTime()) {
      throw new Error('--end must be greater than or equal to --start')
   }
}

function parseDateOption(name) {
   const value = options[name]
   if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [year, month, day] = value.split('-').map(Number)
      return new Date(year, month - 1, day).toISOString()
   }

   const date = new Date(value)
   if (Number.isNaN(date.getTime())) {
      throw new Error(`Invalid date for --${name}: ${value}`)
   }
   return date.toISOString()
}

function printResult(result) {
   console.log(JSON.stringify(result, null, 2))
}

function printHelp() {
   console.log(`
Usage:
  npm run range-client -- create --user-uid <uid> --start <date> --end <date> [--label <label>] [--color <hex>]
  npm run range-client -- edit --uid <range-uid> [--start <date>] [--end <date>] [--label <label>] [--color <hex>]
  npm run range-client -- delete --uid <range-uid>

Connection options:
  --url <url>        Backend URL, default ${DEFAULT_URL}
  --path <path>      Socket.IO path, default ${DEFAULT_PATH}
  --token <token>    Bearer token header, default from SELOMMES_TOKEN or "mytoken"
  --timeout <ms>     Request timeout, default 20000
  --verbose          Enable @jcbuisson/express-x-client debug logs

Dates:
  Date-only values like 2026-06-22 are interpreted as local midnight.
  Full ISO timestamps are also accepted.
`.trim())
}
