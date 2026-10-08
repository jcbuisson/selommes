import { PGlite } from '@electric-sql/pglite'
import { worker } from '@electric-sql/pglite/worker'

worker({ init: async options => new PGlite(options) })
