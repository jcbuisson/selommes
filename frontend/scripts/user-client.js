#!/usr/bin/env node
// ex: npm run user-client -- edit --uid 019eca46-10db-7226-924e-c31a62e7816c --name Christophe

import { randomUUID } from 'node:crypto'
import { io } from 'socket.io-client'
import { Command, InvalidArgumentError } from 'commander'
import { createClient } from '@jcbuisson/express-x-client'

const DEFAULT_URL = process.env.SELOMMES_URL || 'http://localhost:3000'
const DEFAULT_PATH = process.env.SELOMMES_SOCKET_PATH || '/selommes-socket-io/'
const DEFAULT_TIMEOUT = 20000

let app
let timeout

const program = new Command()
   .name('user-client')
   .description('Get, create, edit, or delete users through the ExpressX client.')
   .option('--url <url>', 'Backend URL', DEFAULT_URL)
   .option('--path <path>', 'Socket.IO path', DEFAULT_PATH)
   .option('--timeout <ms>', 'Request timeout in milliseconds', parseTimeout, DEFAULT_TIMEOUT)
   .option('--verbose', 'Enable @jcbuisson/express-x-client debug logs')

program
   .command('get')
   .description('Get an existing user')
   .requiredOption('--uid <user-uid>', 'User uid')
   .action(options => runCommand(options, getUser))

program
   .command('create')
   .description('Create a user')
   .requiredOption('--email <email>', 'User email')
   .requiredOption('--name <name>', 'User name')
   .requiredOption('--color <color>', 'User color')
   .option('--uid <uid>', 'User uid; defaults to a random UUID')
   .action(options => runCommand(options, createUser, validateCreateOptions))

program
   .command('edit')
   .alias('update')
   .description('Edit an existing user')
   .requiredOption('--uid <user-uid>', 'User uid')
   .option('--email <email>', 'New user email')
   .option('--name <name>', 'New user name')
   .option('--color <color>', 'New user color')
   .action(options => runCommand(options, editUser, validateEditOptions))

program
   .command('delete')
   .alias('remove')
   .description('Delete an existing user')
   .requiredOption('--uid <user-uid>', 'User uid')
   .action(options => runCommand(options, deleteUser))

if (process.argv.length === 2) {
   program.outputHelp()
   process.exit(1)
}

await program.parseAsync()

async function runCommand(options, handler, validateOptions) {
   let socket

   try {
      validateOptions?.(options)

      const globalOptions = program.opts()
      timeout = globalOptions.timeout

      socket = io(globalOptions.url, {
         path: globalOptions.path,
         transports: ['websocket'],
      })

      app = createClient(socket, { debug: Boolean(globalOptions.verbose) })
      await waitForConnect(socket, timeout)
      printResult(await handler(options))
   } catch (error) {
      console.error(error?.message || error)
      process.exitCode = 1
   } finally {
      socket?.disconnect()
   }
}

async function createUser(options) {
   const uid = options.uid || randomUUID()
   const data = {
      email: options.email,
      name: options.name,
      color: options.color,
   }

   return app.service('user', { timeout }).createWithMeta(uid, data, new Date().toISOString())
}

async function getUser(options) {
   const user = await app.service('user', { timeout }).findUnique({ uid: options.uid })
   if (!user) throw new Error(`User not found: ${options.uid}`)
   return user
}

async function editUser(options) {
   const uid = options.uid
   const existing = await app.service('user', { timeout }).findUnique({ uid })
   if (!existing) throw new Error(`User not found: ${uid}`)

   const data = {
      email: options.email || existing.email,
      name: options.name || existing.name,
      color: options.color || existing.color,
   }

   return app.service('user', { timeout }).updateWithMeta(uid, data, new Date().toISOString())
}

async function deleteUser(options) {
   return app.service('user', { timeout }).deleteWithMeta(options.uid, new Date().toISOString())
}

function validateCreateOptions(options) {
   validateRequiredValue(options.email, 'email')
   validateRequiredValue(options.name, 'name')
   validateRequiredValue(options.color, 'color')
}

function validateEditOptions(options) {
   if (!hasAnyOption(options, ['email', 'name', 'color'])) {
      throw new Error('Missing update data: provide at least one of --email, --name, or --color')
   }
   for (const name of ['email', 'name', 'color']) {
      if (options[name] !== undefined) validateRequiredValue(options[name], name)
   }
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

function hasAnyOption(options, names) {
   return names.some(name => options[name] !== undefined)
}

function validateRequiredValue(value, name) {
   if (!String(value || '').trim()) {
      throw new Error(`--${name} cannot be empty`)
   }
}

function printResult(result) {
   console.log(JSON.stringify(result, null, 2))
}

function parseTimeout(value) {
   const parsed = Number(value)
   if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new InvalidArgumentError(`Invalid timeout: ${value}`)
   }
   return parsed
}
