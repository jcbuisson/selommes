# Selommes

Selommes uses [Rocicorp Zero](https://zero.rocicorp.dev/) for reactive queries, optimistic offline mutations, and Postgres synchronization.


zero : ALTER SYSTEM SET wal_level = logical;
express-x :  ALTER SYSTEM SET wal_level = replica;


## Development

Install dependencies in both `backend` and `frontend`, then start these three processes:

```sh
cd backend
npm install
npm run dev
```

```sh
cd backend
npm run dev:zero
```

```sh
cd frontend
npm install
npm run dev
```

The frontend connects to Zero at `VITE_ZERO_CACHE_URL` (default: `http://localhost:4848`). The development launcher reads `backend/.env`, uses `ZERO_UPSTREAM_DB` or falls back to `DATABASE_URL`, and defaults the query and mutate endpoints to the local backend.

Postgres must allow logical replication, and `ZERO_UPSTREAM_DB` must be a direct connection rather than a pooled connection.
