# Chart of Accounts + General Ledger — Schema Sketch

> **Status: implemented — including the remaining IFRS modules.** All
> Currency/GL models below are live in `prisma/schema.prisma` and seeded in
> `prisma/seed.js`. Additionally, four more modules now exist covering the
> rest of the IFRS scope: `FixedAsset`/`DepreciationEntry` (IAS 16),
> `Lease`/`LeasePayment` (IFRS 16), `RevenueContract`/`RevenueRecognitionEntry`
> (IFRS 15), and `InventoryValuation` (IAS 2 NRV write-downs). Run
> `npm run db:push` to apply the schema, then `npx prisma db seed`. This doc
> is kept as the design rationale for the Currency/GL layer specifically —
> see the live schema for the full current state, including the newer
> modules.

This adds the accounting foundation everything IFRS-specific eventually
builds on. Six new models, following the same conventions already in
`prisma/schema.prisma` (cuid for transactional rows, autoincrement Int for
reference tables, snake_case `@map`).

## 0. Currency + ExchangeRate — currency setup

A pharmacy operating in Ghana reports in Ghanaian Cedis, but very likely buys
stock from suppliers invoicing in USD/EUR/GBP — this is exactly what
**IAS 21 (The Effects of Changes in Foreign Exchange Rates)** governs, and
why currency needs to be a first-class, configurable thing rather than a
hardcoded string.

```prisma
model Currency {
  id             Int      @id @default(autoincrement()) @map("currency_id")
  code           String   @unique                          // ISO 4217: "GHS", "USD", "EUR"
  name           String                                     // "Ghanaian Cedi"
  symbol         String                                     // "GH₵"
  decimalPlaces  Int      @default(2) @map("decimal_places")
  isBaseCurrency Boolean  @default(false) @map("is_base_currency")
  isActive       Boolean  @default(true) @map("is_active")
  createdAt      DateTime @default(now()) @map("created_at")

  exchangeRates  ExchangeRate[]
  journalEntries JournalEntry[]
  suppliers      Supplier[]

  @@map("currencies")
}

model ExchangeRate {
  id         Int      @id @default(autoincrement()) @map("exchange_rate_id")
  currencyId Int      @map("currency_id")              // the foreign currency
  rateDate   DateTime @map("rate_date")
  rateToBase Float    @map("rate_to_base")              // 1 unit of this currency = X GHS
  source     String   @default("MANUAL") @map("source") // MANUAL | API
  createdAt  DateTime @default(now()) @map("created_at")

  currency Currency @relation(fields: [currencyId], references: [id])

  @@unique([currencyId, rateDate])
  @@map("exchange_rates")
}
```

**Exactly one** `Currency` row should have `isBaseCurrency = true` at a time
— SQLite can't express "only one row where X is true" as a declarative
constraint, so enforce it in a `setBaseCurrency()` service function that
atomically unsets the previous base before setting the new one.

**Seed data** — this is where Ghana enters the picture, as the base currency
rather than something hardcoded:

```ts
await prisma.currency.create({
  data: { code: 'GHS', name: 'Ghanaian Cedi', symbol: 'GH₵', decimalPlaces: 2, isBaseCurrency: true },
});
// Add others as needed — only isActive ones show up in currency pickers:
await prisma.currency.createMany({
  data: [
    { code: 'USD', name: 'US Dollar', symbol: '$', decimalPlaces: 2 },
    { code: 'EUR', name: 'Euro', symbol: '€', decimalPlaces: 2 },
    { code: 'GBP', name: 'British Pound', symbol: '£', decimalPlaces: 2 },
    { code: 'NGN', name: 'Nigerian Naira', symbol: '₦', decimalPlaces: 2 },
  ],
});
```

**Where this touches the rest of the schema:**

- **`Supplier`** gets an optional `invoiceCurrencyId` — a foreign supplier's
  invoices are naturally in their own currency, converted to GHS at posting
  time using that day's `ExchangeRate`.
- **`JournalEntry`** (below) gets `currencyId` + `exchangeRate` — every
  entry knows what currency the underlying transaction happened in and what
  rate converted it, even though the ledger balances themselves
  (`JournalLine.debit`/`credit`) always stay in GHS. This is the standard
  pattern: transactions are recorded in the *functional currency* (GHS) but
  the original transaction currency and rate are preserved for audit and for
  IAS 21's period-end retranslation of monetary items.

```prisma
// addition to Supplier:
model Supplier {
  // ...existing fields...
  invoiceCurrencyId Int? @map("invoice_currency_id")
  invoiceCurrency   Currency? @relation(fields: [invoiceCurrencyId], references: [id])
}
```

## 1. Account — the Chart of Accounts itself

```prisma
model Account {
  id            Int      @id @default(autoincrement()) @map("account_id")
  accountCode   String   @unique @map("account_code")      // e.g. "1000", "4000"
  accountName   String   @map("account_name")               // e.g. "Cash", "Sales Revenue"
  accountType   String   @map("account_type")               // ASSET | LIABILITY | EQUITY | REVENUE | EXPENSE
  accountSubType String? @map("account_sub_type")           // CURRENT_ASSET, FIXED_ASSET, COGS, etc.
  normalBalance String   @map("normal_balance")             // DEBIT | CREDIT — drives validation & reports
  parentAccountId Int?   @map("parent_account_id")          // self-relation, for hierarchy/roll-ups
  isActive      Boolean  @default(true) @map("is_active")
  createdAt     DateTime @default(now()) @map("created_at")

  parentAccount Account?  @relation("AccountHierarchy", fields: [parentAccountId], references: [id])
  childAccounts Account[] @relation("AccountHierarchy")
  journalLines  JournalLine[]

  @@map("accounts")
}
```

`accountType` and `normalBalance` are plain strings rather than enums — same
choice the rest of this schema already made for SQLite (no native enum
support). Validate the allowed values in the service layer.

## 2. JournalEntry — the transaction header

```prisma
model JournalEntry {
  id           String   @id @default(cuid()) @map("entry_id")
  entryNumber  String   @unique @map("entry_number")        // e.g. "JE-2026-000123"
  branchId     String   @map("branch_id")
  entryDate    DateTime @map("entry_date")
  description  String?
  sourceType   String   @map("source_type")                 // SALE | STOCK_ADJUSTMENT | TRANSFER | PURCHASE | MANUAL
  sourceId     String?  @map("source_id")                   // points back to Sale.id, StockAdjustment.id, etc.
  status       String   @default("POSTED") @map("status")   // DRAFT | POSTED | REVERSED
  currencyId   Int      @map("currency_id")                 // transaction currency (defaults to base/GHS)
  exchangeRate Float    @default(1.0) @map("exchange_rate")  // rate to base currency on entryDate; 1.0 if already GHS
  postedByUserId Int    @map("posted_by_user_id")
  reversedByEntryId String? @map("reversed_by_entry_id")    // set on the original entry once reversed
  createdAt    DateTime @default(now()) @map("created_at")

  currency     Currency       @relation(fields: [currencyId], references: [id])
  postedByUser User           @relation(fields: [postedByUserId], references: [id])
  lines        JournalLine[]

  @@map("journal_entries")
}
```

`sourceType` + `sourceId` is a loose polymorphic reference (not a real FK,
since it can point at several different tables) — that's how a `Sale`
becomes traceable to the journal entry it generated, and vice versa.

## 3. JournalLine — the double-entry detail rows

```prisma
model JournalLine {
  id          String  @id @default(cuid()) @map("line_id")
  journalEntryId String @map("journal_entry_id")
  accountId   Int     @map("account_id")
  debit       Float   @default(0)
  credit      Float   @default(0)
  description String?
  productId   Int?    @map("product_id")   // optional dimension, useful for inventory-account drill-down

  journalEntry JournalEntry @relation(fields: [journalEntryId], references: [id], onDelete: Cascade)
  account      Account      @relation(fields: [accountId], references: [id])
  product      Product?     @relation(fields: [productId], references: [id])

  @@map("journal_lines")
}
```

Every line is either a debit or a credit, never both — enforce that (and that
`sum(debit) == sum(credit)` across all lines in a `JournalEntry`) in the
posting service, not the database. SQLite/Prisma can't express a
cross-row-sum constraint declaratively.

## 4. AccountingPeriod — controls what can still be posted to

```prisma
model AccountingPeriod {
  id           Int      @id @default(autoincrement()) @map("period_id")
  periodName   String   @unique @map("period_name")   // e.g. "2026-08"
  startDate    DateTime @map("start_date")
  endDate      DateTime @map("end_date")
  status       String   @default("OPEN") @map("status")  // OPEN | CLOSED | LOCKED
  closedByUserId Int?   @map("closed_by_user_id")
  closedAt     DateTime? @map("closed_at")

  closedByUser User? @relation(fields: [closedByUserId], references: [id])

  @@map("accounting_periods")
}
```

Every posting checks the entry date falls inside an `OPEN` period before
allowing it through — this is what prevents someone from posting a
correction into a month that's already been reported on.

## 5. GLAccountMapping — how operational events become journal entries automatically

```prisma
model GLAccountMapping {
  id        Int    @id @default(autoincrement()) @map("mapping_id")
  mappingKey String @unique @map("mapping_key")  // "INVENTORY_ASSET", "COGS", "SALES_REVENUE", "CASH", "TAX_PAYABLE", "AR"
  accountId Int    @map("account_id")

  account Account @relation(fields: [accountId], references: [id])

  @@map("gl_account_mappings")
}
```

This is the piece that lets a `createSale()` call auto-generate a journal
entry instead of someone manually picking accounts every time. The posting
service looks up `"CASH"` → whatever `Account` row you've configured, rather
than hardcoding an account ID.

---

## How this connects to what already exists

Nothing in the current schema needs to change. This layer sits *beside* the
operational tables and gets populated by hooking into the existing service
functions — a POS sale (in GHS, `currencyId` = the base currency,
`exchangeRate` = 1.0) would post something like:

| Account (via mapping key) | Debit (GHS) | Credit (GHS) |
|---|---|---|
| CASH (or AR, if not immediate payment) | totalAmount | |
| SALES_REVENUE | | subtotalAmount |
| TAX_PAYABLE | | taxAmount |
| COGS | sum(batch.purchasePrice × qty) | |
| INVENTORY_ASSET | | sum(batch.purchasePrice × qty) |

That last pair (COGS / Inventory) is the IAS 2 piece — it's why the sale
service needs to know each batch's *purchase* price, not just its selling
price, to post the inventory reduction at cost rather than at the sale price.

A supplier purchase invoiced in USD would instead set `currencyId` to USD's
row and `exchangeRate` to that day's `ExchangeRate.rateToBase` — the
`JournalLine.debit`/`credit` amounts posted to `INVENTORY_ASSET`/`AP` are
still stored in GHS (original amount × rate), but the entry itself records
that it originated in USD, so you can always trace back to "this cost
$450 USD on the day it was purchased."

A `StockAdjustment` for expired/damaged stock would post similarly:
debit an **Inventory Write-Down (Expense)** account, credit
**Inventory Asset** — turning what's currently just a quantity change into
a properly recognized loss.

## Suggested build order

1. `Currency` + `ExchangeRate` — seed GHS as base currency first; everything
   money-related downstream (`Account` balances, `JournalEntry`) assumes a
   base currency already exists
2. `Account` + seed a basic Chart of Accounts (10–20 accounts is enough to
   start: Cash, AR, Inventory, AP, Sales Revenue, COGS, Tax Payable, a few
   expense accounts)
3. `GLAccountMapping` + seed the mapping keys above
4. `JournalEntry` + `JournalLine` + a `postJournalEntry()` service function
   that enforces debits = credits and rejects unbalanced entries
5. Hook `createSale()` to call `postJournalEntry()` after a successful sale
6. `AccountingPeriod` once you're ready to lock historical months
7. Only then layer in the IFRS-specific modules from before (inventory
   valuation/NRV, revenue recognition edge cases, etc.) — they all assume
   this foundation exists
