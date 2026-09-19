# IFRS Modules: Fixed Assets, Leases, Revenue Recognition, Inventory Valuation

Four modules added to `prisma/schema.prisma`, building on the Currency +
Chart of Accounts + General Ledger foundation (see
`accounting-schema-sketch.md`). All are seeded with one example row each in
`prisma/seed.js` — enough to prove the models work, not a real dataset.

## Fixed Assets & Depreciation — IAS 16

| Model | Purpose |
|---|---|
| `FixedAsset` | One row per asset — cost, residual value, useful life, depreciation method, and which GL accounts it rolls up to (asset, accumulated depreciation, expense) |
| `DepreciationEntry` | One row per asset per accounting period — this period's depreciation charge and the running net book value after it |

`FixedAsset` links to **three separate `Account` rows** because IAS 16
depreciation always touches three places on the financial statements at
once: the asset itself (at cost, never changed), a contra-asset
"accumulated depreciation" account that grows each period, and a
depreciation expense line on the income statement. `DepreciationEntry` is
what a periodic depreciation-run job would create — one row per asset,
per period, each optionally linked to the `JournalEntry` it generated.

## Leases — IFRS 16

| Model | Purpose |
|---|---|
| `Lease` | One row per lease — the initial right-of-use (ROU) asset value and lease liability, calculated as the present value of future payments at the lease's discount rate |
| `LeasePayment` | One row per lease per period — splits each payment into interest (unwinding the discount) vs. principal (reducing the liability), plus that period's ROU asset amortization |

The key IFRS 16 idea this captures: operating leases are **not** just a
monthly expense anymore — they go on the balance sheet as both an asset
(the right to use the space) and a liability (the obligation to pay for
it), and both get reduced over the lease term in a specific,
calculable way. `LeasePayment.remainingLiability` is the running balance
that should tie out to the Lease Liability account on the balance sheet.

## Revenue Recognition — IFRS 15

| Model | Purpose |
|---|---|
| `RevenueContract` | An arrangement where revenue isn't recognized all at once — the leading example for a pharmacy is insurance billing (NHIS or private insurers), where you've provided the service but get paid, and recognize the revenue, over time |
| `RevenueRecognitionEntry` | One row per contract per period — this period's slice of `recognizedRevenue`, moving it out of `deferredRevenue` |

Ordinary POS sales don't need this at all — they're point-in-time and the
`Sale` model already handles them completely. This module exists
specifically for the exception: `RevenueContract.saleId` optionally links
back to an originating `Sale` if the contract started from one.

## Inventory Valuation / Net Realizable Value — IAS 2

| Model | Purpose |
|---|---|
| `InventoryValuation` | A documented valuation of a specific batch — cost vs. estimated net realizable value, and the write-down required if NRV has fallen below cost |

This formalizes what `StockAdjustment` already does informally for
quantity corrections, but specifically for **valuation** write-downs (stock
that's still physically there and sellable, just worth less than it cost —
typically because it's near expiry). The write-down amount
(`max(0, cost − NRV) × quantityOnHand`) is exactly what IAS 2 requires you
to recognize as a loss, and `journalEntryId` is where that loss actually
gets posted to the P&L.

## What's built now (frontend + API)

An **"Accounting" section** now exists in the app's sidebar, with seven tabs:
Chart of Accounts, Journal Entries, Currencies, Fixed Assets, Leases,
Revenue, and Valuations. Each is backed by a real API route:

| Route | Purpose |
|---|---|
| `GET/POST /api/v1/accounts` | List / create Chart of Accounts entries |
| `GET/POST /api/v1/journal-entries` | List / post journal entries — **validates debits = credits server-side**, rejects unbalanced entries, auto-generates entry numbers (`JE-2026-000001`) |
| `GET/POST /api/v1/currencies` | List / add currencies |
| `POST /api/v1/currencies/:id/set-base` | Atomically switch the base currency |
| `GET/POST /api/v1/fixed-assets` | List / add fixed assets |
| `GET/POST /api/v1/leases` | List / add leases |
| `GET/POST /api/v1/revenue-contracts` | List / add revenue contracts |
| `GET/POST /api/v1/inventory-valuations` | List / add valuations — server calculates the write-down automatically from cost vs. NRV |

The Journal Entry form is the most involved piece: it lets you add/remove
lines dynamically, picks accounts from a live dropdown, and shows a
running balance check (green "Balanced" / amber "Not balanced") before
letting you post — mirroring the server-side validation exactly.

**Still not built:** the *automated* posting engine — nothing yet
generates a `DepreciationEntry`, `LeasePayment`, or
`RevenueRecognitionEntry` on a schedule, and `createSale()` doesn't
auto-post a journal entry yet either. Everything above is manual/direct
entry through the UI or API. That automation is the natural next step.

## What's still missing (deliberately, for now)

None of these four modules have service-layer logic yet — no
`runMonthlyDepreciation()`, no `postLeasePayment()`, no
`recognizeRevenueForPeriod()`. They're schema only, same as the Currency/GL
layer was before this pass. The natural next step, when you're ready, is
the posting engine that turns these rows into actual `JournalEntry` +
`JournalLine` records — same pattern for all four: calculate the period's
number, write the operational row (`DepreciationEntry`, `LeasePayment`,
etc.), post the matching double-entry journal, link the two via
`journalEntryId`.
