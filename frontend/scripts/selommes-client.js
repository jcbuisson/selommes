#!/usr/bin/env node
// npx @jcbuisson/selommes-client user list
// npx @jcbuisson/selommes-client range list
// npx @jcbuisson/selommes-client range --help

import { randomUUID } from 'node:crypto'
import { io } from 'socket.io-client'
import { Command, InvalidArgumentError } from 'commander'
import { createClient } from '@jcbuisson/express-x-client'

const DEFAULT_URL = process.env.SELOMMES_URL || 'https://selommes.jcbuisson.dev'
const DEFAULT_PATH = process.env.SELOMMES_SOCKET_PATH || '/selommes-socket-io/'
const DEFAULT_TIMEOUT = 20000

let app
let timeout

const program = new Command()
   .name('selommes-client')
   .description('List, get, create, edit, or delete Selommes users and ranges through the ExpressX client.')
   .option('--url <url>', 'Backend URL', DEFAULT_URL)
   .option('--path <path>', 'Socket.IO path', DEFAULT_PATH)
   .option('--timeout <ms>', 'Request timeout in milliseconds', parseTimeout, DEFAULT_TIMEOUT)
   .option('--verbose', 'Enable @jcbuisson/express-x-client debug logs')

const user = program
   .command('user')
   .description('Manage users')

user
   .command('list')
   .description('List users')
   .action(options => runCommand(options, listUsers, undefined, printUserList))

user
   .command('get')
   .description('Get an existing user')
   .requiredOption('--uid <user-uid>', 'User uid')
   .action(options => runCommand(options, getUser))

user
   .command('create')
   .description('Create a user')
   .requiredOption('--email <email>', 'User email')
   .requiredOption('--name <name>', 'User name')
   .requiredOption('--color <color>', 'User color')
   .option('--uid <uid>', 'User uid; defaults to a random UUID')
   .action(options => runCommand(options, createUser, validateUserCreateOptions))

user
   .command('edit')
   .alias('update')
   .description('Edit an existing user')
   .requiredOption('--uid <user-uid>', 'User uid')
   .option('--email <email>', 'New user email')
   .option('--name <name>', 'New user name')
   .option('--color <color>', 'New user color')
   .action(options => runCommand(options, editUser, validateUserEditOptions))

user
   .command('delete')
   .alias('remove')
   .description('Delete an existing user')
   .requiredOption('--uid <user-uid>', 'User uid')
   .action(options => runCommand(options, deleteUser))

const range = program
   .command('range')
   .description('Manage ranges')

range
   .command('list')
   .description('List ranges')
   .action(options => runCommand(options, listRanges, undefined, printRangeList))

range
   .command('get')
   .description('Get an existing range')
   .requiredOption('--uid <range-uid>', 'Range uid')
   .action(options => runCommand(options, getRange))

range
   .command('create')
   .description('Create a range')
   .requiredOption('--user-uid <uid>', 'Owner user uid')
   .requiredOption('--start <date>', 'Range start date or ISO timestamp')
   .requiredOption('--end <date>', 'Range end date or ISO timestamp')
   .option('--uid <uid>', 'Range uid; defaults to a random UUID')
   .option('--label <label>', 'Range label; defaults to the user name')
   .option('--color <hex>', 'Range color; defaults to the user color')
   .action(options => runCommand(options, createRange, validateRangeCreateOptions))

range
   .command('edit')
   .alias('update')
   .description('Edit an existing range')
   .requiredOption('--uid <range-uid>', 'Range uid')
   .option('--user-uid <uid>', 'New owner user uid')
   .option('--start <date>', 'New range start date or ISO timestamp')
   .option('--end <date>', 'New range end date or ISO timestamp')
   .option('--label <label>', 'New range label')
   .option('--color <hex>', 'New range color')
   .action(options => runCommand(options, editRange, validateRangeEditOptions))

range
   .command('delete')
   .alias('remove')
   .description('Delete an existing range')
   .requiredOption('--uid <range-uid>', 'Range uid')
   .action(options => runCommand(options, deleteRange))

program.addHelpText('after', `

Dates:
  Date-only values like 2026-06-22 are interpreted as local midnight.
  Full ISO timestamps are also accepted.`)

if (process.argv.length === 2) {
   program.outputHelp()
   process.exit(1)
}

await program.parseAsync()

async function runCommand(options, handler, validateOptions, print = printResult) {
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
      print(await handler(options))
   } catch (error) {
      console.error(error?.message || error)
      process.exitCode = 1
   } finally {
      socket?.disconnect()
   }
}

async function listUsers() {
   return app.service('user', { timeout }).findMany({})
}

async function getUser(options) {
   const user = await app.service('user', { timeout }).findUnique({ uid: options.uid })
   if (!user) throw new Error(`User not found: ${options.uid}`)
   return user
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

async function listRanges() {
   return app.service('range', { timeout }).findMany({})
}

async function getRange(options) {
   const range = await app.service('range', { timeout }).findUnique({ uid: options.uid })
   if (!range) throw new Error(`Range not found: ${options.uid}`)
   return range
}

async function createRange(options) {
   const start = parseDateOption(options.start, 'start')
   const end = parseDateOption(options.end, 'end')
   ensureChronologicalRange(start, end)

   const userUid = options.userUid
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

async function editRange(options) {
   const uid = options.uid
   const existing = await app.service('range', { timeout }).findUnique({ uid })
   if (!existing) throw new Error(`Range not found: ${uid}`)

   if (options.userUid) {
      const user = await app.service('user', { timeout }).findUnique({ uid: options.userUid })
      if (!user) throw new Error(`User not found: ${options.userUid}`)
   }

   const data = {
      user_uid: options.userUid || existing.user_uid,
      label: options.label || existing.label,
      color: options.color || existing.color,
      start: options.start ? parseDateOption(options.start, 'start') : existing.start,
      end: options.end ? parseDateOption(options.end, 'end') : existing.end,
   }
   ensureChronologicalRange(data.start, data.end)

   return app.service('range', { timeout }).updateWithMeta(uid, data, new Date().toISOString())
}

async function deleteRange(options) {
   return app.service('range', { timeout }).deleteWithMeta(options.uid, new Date().toISOString())
}

function validateUserCreateOptions(options) {
   validateRequiredValue(options.email, 'email')
   validateRequiredValue(options.name, 'name')
   validateRequiredValue(options.color, 'color')
}

function validateUserEditOptions(options) {
   if (!hasAnyOption(options, ['email', 'name', 'color'])) {
      throw new Error('Missing update data: provide at least one of --email, --name, or --color')
   }
   for (const name of ['email', 'name', 'color']) {
      if (options[name] !== undefined) validateRequiredValue(options[name], name)
   }
}

function validateRangeCreateOptions(options) {
   const start = parseDateOption(options.start, 'start')
   const end = parseDateOption(options.end, 'end')
   ensureChronologicalRange(start, end)
}

function validateRangeEditOptions(options) {
   if (!hasAnyOption(options, ['userUid', 'start', 'end', 'label', 'color'])) {
      throw new Error('Missing update data: provide at least one of --user-uid, --start, --end, --label, or --color')
   }
   if (options.start) parseDateOption(options.start, 'start')
   if (options.end) parseDateOption(options.end, 'end')
   if (options.start && options.end) {
      ensureChronologicalRange(parseDateOption(options.start, 'start'), parseDateOption(options.end, 'end'))
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

function ensureChronologicalRange(start, end) {
   if (new Date(end).getTime() < new Date(start).getTime()) {
      throw new Error('--end must be greater than or equal to --start')
   }
}

function parseDateOption(value, name) {
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

function printUserList(users) {
   for (const user of users) {
      console.log(`${user.uid} ${user.name}`)
   }
}

function printRangeList(ranges) {
   for (const range of ranges) {
      console.log(`${range.uid} ${range.user_uid} ${formatDateOnly(range.start)} ${formatDateOnly(range.end)} ${range.label}`)
   }
}

function formatDateOnly(value) {
   const date = new Date(value)
   if (Number.isNaN(date.getTime())) return value
   return date.toISOString().slice(0, 10)
}

function parseTimeout(value) {
   const parsed = Number(value)
   if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new InvalidArgumentError(`Invalid timeout: ${value}`)
   }
   return parsed
}
