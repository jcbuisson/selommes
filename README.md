# Selommes

Shared calendar built with Vue/Vite, Express-X, PostgreSQL and Electric. The Electric
client plugin manages a persistent PGlite database and synchronization across browser tabs.

## Install and run the development version

### Prerequisites

- Node.js 24 LTS and npm. The production process uses Node's native TypeScript support.
- PostgreSQL 17, with logical replication enabled.
- Docker with Docker Compose.
- SMTP credentials for registration emails.

Clone the repository and install both applications:

```sh
git clone https://github.com/jcbuisson/selommes.git
cd selommes
npm install --prefix backend
npm install --prefix frontend
```

### Create the database

As a PostgreSQL administrator, configure logical replication and restart PostgreSQL
if you changed `wal_level`:

```sql
# set lc_messages=C for the PostgreSQL role so Electric receives recognizable English errors
ALTER ROLE chris SET lc_messages = 'C';

# ALLOW POSTGRES LOGICAL REPLICATION
ALTER SYSTEM SET wal_level = 'logical';
ALTER SYSTEM SET max_replication_slots = 10;
ALTER SYSTEM SET max_wal_senders = 10;
ALTER ROLE chris WITH REPLICATION;

(restart postgres)
```


```sql
CREATE TABLE "user" (
   uid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
   email TEXT NOT NULL UNIQUE,
   name TEXT NOT NULL,
   color TEXT NOT NULL
);

CREATE TABLE "range" (
   uid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
   user_uid UUID REFERENCES "user"(uid),
   start TEXT NOT NULL,
   "end" TEXT NOT NULL,
   label TEXT NOT NULL,
   color TEXT NOT NULL
);
```

These commands are for a new database; keep existing tables and data when upgrading.
At startup, the backend adds the sync `version` and `deleted` columns, mutation
cursor table and version sequence. It also adjusts the user email constraint for
deleted rows. The backend database role therefore needs permission to alter these
tables.

See the [Electric deployment guide](https://electric.ax/docs/sync/guides/deployment)
for PostgreSQL replication and connection requirements.

### Configure the backend

Create `backend/.env`:

```dotenv
PORT=8000
DATABASE_URL=postgresql://selommes:replace-with-your-password@localhost:5432/selommes
ELECTRIC_URL=http://localhost:3217/v1/shape

MAIL_HOST=smtp.example.com
MAIL_PORT=587
MAIL_USER=your-smtp-user
MAIL_PASSWORD=your-smtp-password
MAIL_DOMAIN=example.com
MAIL_SENDER=Selommes <calendar@example.com>
```

Use URL-encoded passwords in database URLs. The mail service uses `secure: false`;
configure an SMTP endpoint supporting STARTTLS, typically on port 587.

Edit `backend/docker-compose.yml` to use the same database and credentials in its
`DATABASE_URL`. From Docker Desktop, PostgreSQL on the host is reached through
`host.docker.internal`, rather than `localhost`:

```yaml
DATABASE_URL: postgresql://selommes:replace-with-your-password@host.docker.internal:5432/selommes
```

For Linux Docker Engine, add this to the Electric service:

```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

PostgreSQL must accept connections from the Docker network; configure
`listen_addresses` and `pg_hba.conf` for that network. Keep the Electric host port
`3217` and `ELECTRIC_REPLICATION_STREAM_ID: "selommes"`. The stream ID avoids
replication-slot conflicts with other applications on the same PostgreSQL server.

### Configure and start the frontend

Create `frontend/.env.development`:

```dotenv
VITE_SELOMMES_URL=http://localhost:8080
```

This URL is used in registration email links. Start Electric:

```sh
cd backend
npm run electric:up
curl --fail http://localhost:3217/v1/health
```

The health response should report `"status":"active"`. In two separate terminals,
from the repository root, start the backend and frontend:

```sh
cd backend
npm run dev
```

```sh
cd frontend
npm run dev
```

Open <http://localhost:8080>. Vite proxies `/electric` and
`/selommes-socket-io/` to the backend on port `8000`. The backend proxies Shapes
to Electric on port `3217`. Browser workers and locks require localhost or HTTPS;
use HTTPS when accessing development from another device.

Stop Electric with `npm run electric:down` from `backend`. Avoid
`electric:reset` when you need to retain Electric's persistent state.

## Deploy in production

The following example uses a Linux server with PostgreSQL, Docker, PM2 and Nginx.
Replace `calendar.example.com`, credentials and filesystem paths with your values.

The current backend uses `authorize: async () => true`, and the mail service is
also exposed without session checks. Before making the application public,
implement authentication and server-side authorization for Shapes, mutations and
mail requests. The browser's user ID and calendar edit controls do not enforce
server permissions. The deployment below can otherwise be used on a trusted,
access-controlled network.

### Install and configure the services

Install the prerequisites, clone the repository into `/srv/selommes`, install
backend/frontend dependencies, and create or restore the database as described
above. Configure `backend/.env` with production database and SMTP credentials.
Keep `PORT=8000` and `ELECTRIC_URL=http://localhost:3217/v1/shape` for this example.

Create `backend/docker-compose.production.yml` with a tested, pinned Electric
image version. Set `ELECTRIC_IMAGE` and `ELECTRIC_DATABASE_URL` in `backend/.env`:

```dotenv
ELECTRIC_IMAGE=electricsql/electric:1.7.8
ELECTRIC_DATABASE_URL=postgresql://selommes:replace-with-your-password@host.docker.internal:5432/selommes
```

```yaml
services:
  electric-selommes:
    image: ${ELECTRIC_IMAGE:?Set ELECTRIC_IMAGE}
    restart: unless-stopped
    extra_hosts:
      - "host.docker.internal:host-gateway"
    environment:
      DATABASE_URL: ${ELECTRIC_DATABASE_URL:?Set ELECTRIC_DATABASE_URL}
      ELECTRIC_INSECURE: "true"
      ELECTRIC_REPLICATION_STREAM_ID: "selommes"
      ELECTRIC_STORAGE_DIR: /var/lib/electric
    ports:
      - "127.0.0.1:3217:3000"
    volumes:
      - electric-data:/var/lib/electric

volumes:
  electric-data:
```

This is a standalone Compose file, used instead of the development file.
`ELECTRIC_INSECURE` is enabled because Electric is private and accessed through
the backend proxy; do not expose its port publicly. The volume preserves its Shape
cache across restarts. See [Electric's storage guidance](https://electric.ax/docs/sync/guides/deployment#configuring-storage)
when changing database connections or storage locations.

Start Electric and verify readiness:

```sh
cd /srv/selommes/backend
docker compose -f docker-compose.production.yml up -d --wait
curl --fail http://localhost:3217/v1/health
```

### Build the frontend and start the backend

Build the frontend with the public HTTPS origin:

```sh
cd /srv/selommes/frontend
VITE_SELOMMES_URL=https://calendar.example.com npm run build
```

The result is `frontend/dist`. Vite environment variables are embedded at build
time; rebuild when changing the public origin. The PWA build includes the PGlite
worker, WASM and database assets needed for offline reloads. Deploy the entire
`dist` directory together.

Install PM2 and start the existing backend process configuration:

```sh
npm install -g pm2
cd /srv/selommes/backend
NODE_ENV=production pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Run the startup command PM2 prints to enable the service after reboot. The existing
configuration uses `--experimental-strip-types`; run it with Node.js 24. Start PM2
from the backend directory so `.env` and `./src/app.js` resolve correctly. Check
startup with `pm2 logs selommes --lines 50`.

### Serve the app over HTTPS

Configure DNS and obtain a TLS certificate for the public domain. Add an Nginx
server configuration like the following, adjusting certificate paths:

```nginx
server {
    listen 80;
    server_name calendar.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name calendar.example.com;

    ssl_certificate /etc/letsencrypt/live/calendar.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/calendar.example.com/privkey.pem;

    root /srv/selommes/frontend/dist;
    index index.html;

    location /selommes-socket-io/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 120s;
    }

    location /electric/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 120s;
    }

    location = /sw.js {
        add_header Cache-Control "no-cache";
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Both `proxy_pass` directives preserve the request path. `/electric/` must go
through the backend's model-aware proxy. The SPA fallback allows direct navigation
to `/agenda`, `/auth` and registration links. Keep Node port `8000` and PostgreSQL
port `5432` private. Nginx must be able to read the complete `dist` directory.

Validate and reload Nginx:

```sh
sudo nginx -t
sudo systemctl reload nginx
```

See the [Nginx WebSocket documentation](https://nginx.org/en/docs/http/websocket.html)
for the upgrade headers used by Socket.IO.

### Update an existing deployment

Back up PostgreSQL, update the checkout, install dependencies in both directories,
and rebuild the frontend with the production URL. Deploy all generated assets
and restart the backend:

```sh
cd /srv/selommes
git pull
npm install --prefix backend
npm install --prefix frontend
cd frontend
VITE_SELOMMES_URL=https://calendar.example.com npm run build
cd ../backend
NODE_ENV=production pm2 restart selommes --update-env
```

Keep previous hashed frontend assets available during deployment if existing
browser sessions may still request them. Reload the page or accept the PWA update
when prompted. Verify email registration, creation/editing of a range, and sync
between two tabs after deployment.
