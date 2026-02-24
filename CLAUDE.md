# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Selommes** (also called **Nutri-Educ**) is a nutritional education web application. It has a decoupled architecture:
- **frontend/**: Vue 3 + Vite SPA (actively developed)
- **backend/**: Feathers.js + PostgreSQL API (present on `master`, may be absent on feature branches)

## Commands

### Frontend

```bash
cd frontend
npm install
npm run dev      # Dev server at http://localhost:5173
npm run build    # Production build → dist/
npm run preview  # Preview production build
```

### Backend

```bash
cd backend
npm install

# One-time setup
npm run create-tables       # Create DB schema (dev)
npm run create-tables:test  # Create DB schema (test)
npm run create-admin        # Interactive: prompts for email & password
npm run create-admin -- "<email>" "<password>"  # Non-interactive

# Development
npm run dev     # nodemon auto-reload
npm run start   # Production

# Tests & linting
npm run test    # lint + mocha
npm run mocha   # Mocha tests only (15s timeout, NODE_ENV=test)
npm run lint    # ESLint with auto-fix
```

## Backend Environment Variables

All config is read exclusively from environment variables (no `.env` files):

| Variable | Purpose |
|---|---|
| `NUTRIX_PORT` | HTTP port |
| `NUTRIX_AUTH_SECRET` | JWT signing secret |
| `NUTRIX_DB_URL` | PostgreSQL connection URL (dev) |
| `NUTRIX_TESTDB_URL` | PostgreSQL connection URL (test) |
| `NUTRIX_LOGS_DIR` | Winston log output directory |
| `NUTRIX_UPLOADS_DIR` | Static file uploads directory |

## Architecture

### Backend (Feathers.js)
- **Services** in `src/services/` wrap database operations with a Feathers hooks pipeline (`hooks.js`, `model.js`, `service.js` per service)
- **Hooks** handle authentication, validation, and transformation before/after service calls
- **Database**: Knex.js query builder against PostgreSQL; schema created via `src/scripts/create-tables.js`
- **Auth**: JWT (100-year expiry) + local strategy (email/password with bcrypt); configured in `src/authentication.js`
- **Static files**: served from `NUTRIX_UPLOADS_DIR` at `/static`
- **Entry point**: `src/index.js` starts the Express/Feathers server; `src/app.js` wires all middleware and services

### Frontend (Vue 3)
- Vue 3 Composition API with `<script setup>` SFCs
- Vite for dev server and production builds
- No state management library currently configured

### Testing
- Backend tests in `test/` use Mocha; they automatically drop/recreate the test DB and run the server on port 8998
- `NODE_ENV=test` activates `backend/config/test.js` overrides (test DB URL)
