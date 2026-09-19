# Bizness Shop-OS

A full pharmacy/retail management system — POS, inventory, warehouse,
procurement, prescriptions, transfers, catalog, accounting, payroll,
reports, users, and audit logging — built as a single Next.js 16 app
(API routes + React frontend) backed by SQLite via Prisma. Runs fully
offline: no external database server, no third-party services.

## Modules

- **Dashboard** — overview and KPIs
- **Point of Sale** — new sale, sales history
- **Inventory** — batches, receive goods, low stock, expiring soon
- **Warehouse** — warehouse stock handling
- **Procurement** — purchase orders, goods receipts
- **Prescriptions** — dispensing records
- **Transfers** — inter-branch stock transfers
- **Catalog** — products, suppliers
- **Accounting** — chart of accounts, journal entries, payments,
  currencies, exchange rates, fixed assets, leases, revenue contracts,
  inventory valuations, accounting periods
- **Payroll** *(Admin/Manager)* — employees, pay runs, PAYE/SSNIT tax
  settings
- **Reports** — income statement, balance sheet, cash flow, trial
  balance, AP/AR aging, business analysis
- **Users** *(Admin/Manager)* — staff directory and roles
- **Audit Log** *(Admin/Manager)* — system audit trail
- **Settings** — profile, company, branches, GL mappings, approval
  workflow, access control, backup & restore

Multi-branch and multi-company (multi-tenant) support is built in.

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Copy the example file and fill in your own secrets — never reuse the
placeholder values from `.env.example`:

```bash
cp .env.example .env
```

Generate unique values for `JWT_SECRET` and `FIELD_ENCRYPTION_KEY`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Run that twice and paste one result into each variable in `.env`.
`FIELD_ENCRYPTION_KEY` encrypts sensitive payroll PII (SSNIT number,
TIN, bank account) at rest — treat it like any other production secret.

### 3. Set up the database

```bash
npx prisma generate
npx prisma db push
npx prisma db seed
```

This creates a local SQLite database (`db/custom.db`) and seeds only
global reference data — RBAC roles and the current accounting period.
**No demo company, users, or sample data are created.**

### 4. Run it

```bash
npm run dev
```

Open http://localhost:3000. On first run, the login screen has no
accounts to sign in with yet — use **"Create a company"** to set up
your first real company and Admin account. That flow also seeds the
new company's starter currency, chart of accounts, GL mappings, and
payroll tax settings automatically.

Creating a company requires a **license token** — generate one with:

```bash
node scripts/generate-license-token.js ["optional label"] [maxCompanies]
```

### Production build

```bash
npm run build
npm run start
```

## Desktop app & fully offline deployment

For pharmacies that want a proper installed desktop app instead of a
browser tab, and a turnkey offline setup (no `npm install`, no internet
access needed on the pharmacy's own computers after downloading), see:

- `docs/offline-deployment.md` — running the server with zero internet
  dependency, as a downloadable pre-built bundle
- `docs/desktop-app.md` — the Windows/Mac/Linux desktop client
- `docs/deployment-checklist.md` — step-by-step setup for a new site

## Running tests

```bash
npm test
```

Tests run against an isolated `prisma/test.db`, created fresh each run
(`npm run pretest` runs automatically first).

## Project structure

```
prisma/           Database schema, seed script, migrations helper
src/app/api/v1/   Backend API routes (one folder per resource)
src/components/   React components — views/ (one per module), layout/, ui/
src/lib/          Shared server logic (auth, audit log, encryption, ...)
src/hooks/        Client-side data-fetching hooks
src/types/        Shared TypeScript types
scripts/          One-off admin scripts (license tokens, offline server bundle build)
desktop/          Electron desktop client (separate package — see docs/desktop-app.md)
```

## Notes

- SQLite is a single file — back it up by copying `db/custom.db`, or
  use the in-app Settings → Backup & Restore.
- Every deployment must generate its own `JWT_SECRET` and
  `FIELD_ENCRYPTION_KEY` — never share these across environments or
  commit them to version control.
