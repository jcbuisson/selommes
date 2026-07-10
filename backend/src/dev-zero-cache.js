import 'dotenv/config'
import { spawn } from 'node:child_process'

const configuredDB = process.env.ZERO_UPSTREAM_DB || process.env.DATABASE_URL
if (!configuredDB) throw new Error('ZERO_UPSTREAM_DB or DATABASE_URL must be set')

// ORM connection strings sometimes carry `?schema=...`; Zero's Postgres
// driver would forward it as a server setting, which PostgreSQL rejects.
const upstreamURL = new URL(configuredDB)
upstreamURL.searchParams.delete('schema')
const upstreamDB = upstreamURL.toString()

const child = spawn(process.execPath, ['./node_modules/@rocicorp/zero/out/zero/src/zero-cache-dev.js'], {
   cwd: process.cwd(),
   env: {
      ...process.env,
      ZERO_UPSTREAM_DB: upstreamDB,
      ZERO_QUERY_URL: process.env.ZERO_QUERY_URL || 'http://localhost:3000/api/zero/query',
      ZERO_MUTATE_URL: process.env.ZERO_MUTATE_URL || 'http://localhost:3000/api/zero/mutate',
   },
   stdio: 'inherit',
})

for (const signal of ['SIGINT', 'SIGTERM']) {
   process.on(signal, () => child.kill(signal))
}

child.on('exit', code => process.exit(code ?? 1))
