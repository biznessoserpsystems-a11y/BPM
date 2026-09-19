# Automated smoke tests

Addresses the audit's #2 remediation priority: a minimal, real regression
suite covering login, the reactivation-bypass fix, and the two state
machines (Purchase Orders, Inter-Branch Transfers) plus POS checkout —
exactly the classes of bug that have previously shipped silently (see
SYSTEM-AUDIT.md's Functional section on the `userId: 1` regression).

## Running

```
npm test          # one-shot run
npm run test:watch  # watch mode while developing
```

`npm test`'s `pretest` step pushes the schema to a dedicated SQLite file
at `prisma/test.db` (never your real `db/custom.db`) before tests run.
That file is disposable — `pretest` deletes and recreates it on every run,
so tests always start from a clean, known schema.

**Requires a working Prisma engine** (`prisma db push` needs to actually
run). If you're on a network that blocks `binaries.prisma.sh`, this step
will fail — same limitation noted throughout this project's own history.

## How these are structured

- **`fixtures.ts`** — `createTestContext()` builds one fully isolated
  tenant per test file (Company, two Branches, starter Chart of Accounts,
  an ADMIN user) using the exact same `seedStarterAccounting` helper
  `/auth/register-company` uses, so tests exercise real onboarding code
  rather than a parallel test-only setup path. Every test file gets its
  own tenant — nothing is shared or reused across files, so tests can
  never flake because of leftover state from another test.
- **`request-helpers.ts`** — route handlers (`route.ts`'s exported
  `GET`/`POST`/...) are plain functions that take a `NextRequest`; these
  tests call them directly rather than spinning up an HTTP server, which
  is faster and is the standard way to test Next.js App Router routes.
- Tests run **sequentially, single-process** (see `vitest.config.ts`) —
  intentional. They share one real SQLite file, and SQLite doesn't
  handle concurrent writers from separate processes well; parallelizing
  would trade a faster run for occasional "database is locked" failures
  that have nothing to do with the code being tested.

## What's covered vs. what isn't

Covered: login (success/failure/generic-error), the reactivation
password-requirement regression, the full PO lifecycle (DRAFT → ... →
RECEIVED, including that receiving actually creates stock and that
skipping states is rejected), the full transfer lifecycle (including
that approval actually reserves stock and receiving moves it), POS
checkout (stock decrements, oversell is rejected, sale is attributed to
the real caller), and one cross-tenant isolation check on Purchase
Orders.

Not covered yet, worth adding next: prescriptions, returns, payroll runs,
the accounting period close/reopen flow, and broader cross-tenant checks
on the other four newly-scoped entities (Account, Currency, Product,
Supplier, GLAccountMapping) beyond the one PO example here.
