# Review: pharmacy-management-system (Next.js)

## What this is

A complete rebuild of the pharmacy domain as a single **Next.js 16** app —
API routes *and* a full React frontend (dashboard, POS, inventory,
prescriptions, transfers, catalog, users, audit) in one project, using
**SQLite** instead of PostgreSQL. Built by a different agent/tool, using the
Express/Postgres project from earlier in this conversation as its starting
reference (confirmed by `worklog.md`, and by both projects independently
landing on the same demo password `Demo@Password123`).

The big practical upside: **no Docker, no Postgres, no networking headaches**
— SQLite is just a file (`db/custom.db`), already seeded with demo data
(4 users, 5 products, 8 batches, 4 sales, 3 transfers), sitting right in the
project.

## Bugs found and fixed

### 🔴 `.env` had an absolute path from wherever this was built
```
DATABASE_URL=file:/home/z/my-project/db/custom.db
```
That path doesn't exist on your machine — Prisma would fail to find the
database at all. Fixed to a relative path:
```
DATABASE_URL=file:../db/custom.db
```
(Prisma resolves SQLite file paths relative to `prisma/schema.prisma`'s own
location, hence `../db/custom.db` rather than `./db/custom.db`, to reach the
`db/` folder at the project root.)

### 🟡 Production start script required `bun`, which you likely don't have installed
```json
"start": "NODE_ENV=production bun .next/standalone/server.js ..."
```
`bun` is a separate JS runtime you'd need to install separately; there's no
reason this needs it over plain Node. Changed to:
```json
"start": "NODE_ENV=production node .next/standalone/server.js ..."
```
Doesn't affect `npm run dev` (today's testing), only a later `npm start`
after a build.

### 🟡 Transfer approval didn't validate the batch matched the transfer
`POST /api/v1/transfers/[id]/approve` let you approve against *any* batch ID,
without checking it actually belonged to the transfer's source branch or
matched its product. Added that check (mirrors what the Express project
already did) — someone could otherwise approve a transfer using stock from
the wrong branch entirely.

## Known limitation, not fixed

- **`next.config.ts` has `typescript: { ignoreBuildErrors: true }`.** This
  means `npm run build` will succeed even if there are real type errors
  hiding in the code — convenient for fast iteration, risky for anything
  you're relying on. Worth turning off and fixing whatever surfaces, once
  you're past initial testing.
- Windows note: the `start` script's `NODE_ENV=production` prefix syntax
  works on Mac/Linux but not native Windows `cmd`/PowerShell. Only matters
  once you try a production build — not blocking `npm run dev` today.

## Verification performed

- Installed all 851 packages cleanly (`npm install`)
- Confirmed the shipped SQLite database already has all 16 tables and real
  seed data (checked directly with a SQLite query, not just trusting the
  worklog)
- Ran `npx tsc --noEmit` — same pattern as the Express project: every
  remaining error is exclusively about `@prisma/client` types that only
  exist after `prisma generate` runs (which needs the Prisma engine binary,
  blocked by this sandbox's network allowlist — same limitation as before,
  won't affect you on your own machine)
- Started `next dev` successfully and confirmed the server boots
- Hit `POST /api/v1/auth/login` — got as far as the database call itself
  before hitting the same "Prisma client not generated" wall, confirming
  routing, request parsing, and error handling all work; only the DB engine
  binary is unavailable *in this sandbox specifically*
- Read through the login route, transfer approve/receive routes, the auth
  middleware, the Zustand store + authFetch wrapper, and the shared error
  handler — all clean, consistent patterns, no other issues found

## To run it

```bash
npm install
npx prisma generate
npm run dev
```

No `prisma migrate` or `prisma db seed` needed — the database file already
has schema and data. Open `http://localhost:3000` and log in with any of:

| Username | Password |
|---|---|
| `mgr_john`, `rph_sarah`, `tech_mike`, `admin` | `Demo@Password123` |
