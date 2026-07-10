#!/usr/bin/env node
// npx @jcbuisson/selommes-client user list
// npx @jcbuisson/selommes-client range list
// npx @jcbuisson/selommes-client range --help

import { randomUUID } from 'node:crypto'
import { Command, InvalidArgumentError } from 'commander'

const DEFAULT_URL = process.env.SELOMMES_URL || 'https://selommes.jcbuisson.dev'
const DEFAULT_TIMEOUT = 20000

let baseURL
let timeout

const program = new Command()
   .name('selommes-client')
   .description('List, get, create, edit, or delete Selommes users and ranges through the Selommes API.')
   .option('--url <url>', 'Backend URL', DEFAULT_URL)
   .option('--timeout <ms>', 'Request timeout in milliseconds', parseTimeout, DEFAULT_TIMEOUT)

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
   try {
      validateOptions?.(options)

      const globalOptions = program.opts()
      timeout = globalOptions.timeout
      baseURL = globalOptions.url.replace(/\/$/, '')
      print(await handler(options))
   } catch (error) {
      console.error(error?.message || error)
      process.exitCode = 1
   } finally {}
}

async function listUsers() {
   return api('GET', '/api/user')
}

async function getUser(options) {
   const user = await api('GET', `/api/user/${options.uid}`, undefined, true)
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

   return api('POST', '/api/user', { uid, ...data })
}

async function editUser(options) {
   const uid = options.uid
   const existing = await api('GET', `/api/user/${uid}`, undefined, true)
   if (!existing) throw new Error(`User not found: ${uid}`)

   const data = {
      email: options.email || existing.email,
      name: options.name || existing.name,
      color: options.color || existing.color,
   }

   return api('PUT', `/api/user/${uid}`, data)
}

async function deleteUser(options) {
   return api('DELETE', `/api/user/${options.uid}`)
}

async function listRanges() {
   return api('GET', '/api/range')
}

async function getRange(options) {
   const range = await api('GET', `/api/range/${options.uid}`, undefined, true)
   if (!range) throw new Error(`Range not found: ${options.uid}`)
   return range
}

async function createRange(options) {
   const start = parseDateOption(options.start, 'start')
   const end = parseDateOption(options.end, 'end')
   ensureChronologicalRange(start, end)

   const userUid = options.userUid
   const user = await api('GET', `/api/user/${userUid}`, undefined, true)
   if (!user) throw new Error(`User not found: ${userUid}`)

   const uid = options.uid || randomUUID()
   const data = {
      user_uid: user.uid,
      label: options.label || user.name,
      color: options.color || user.color,
      start,
      end,
   }

   return api('POST', '/api/range', { uid, ...data })
}

async function editRange(options) {
   const uid = options.uid
   const existing = await api('GET', `/api/range/${uid}`, undefined, true)
   if (!existing) throw new Error(`Range not found: ${uid}`)

   if (options.userUid) {
      const user = await api('GET', `/api/user/${options.userUid}`, undefined, true)
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

   return api('PUT', `/api/range/${uid}`, data)
}

async function deleteRange(options) {
   return api('DELETE', `/api/range/${options.uid}`)
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

async function api(method, path, body, allowNotFound = false) {
   const response = await fetch(`${baseURL}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
   })
   if (allowNotFound && response.status === 404) return null
   if (!response.ok) throw new Error(`${method} ${path} failed: ${response.status} ${await response.text()}`)
   return response.json()
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
