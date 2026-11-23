// Brings a database created by an EARLIER release up to date, before the
// server starts.
//
// Why this exists: the server bundle ships a ready-made template.db, but that
// is only copied the very first time. A pharmacy already running has its own
// db/custom.db, and the bundle has no migration tooling (no Prisma CLI, no
// internet) — so when a release adds a table, nothing would add it to their
// existing database and the new feature would fail with "no such table".
//
// Rules for anything added here:
//  - ADDITIVE only (new tables/indexes). Never drop, rename, or rewrite
//    existing data.
//  - IDEMPOTENT: each upgrade is skipped when its table already exists, so
//    running this on every start is safe, including on fresh databases whose
//    template.db was built from the current schema.
//  - The SQL must produce exactly what `prisma db push` would for the model
//    in prisma/schema.prisma — the release workflow checks this (it compares
//    the upgraded table's columns with the template's).
const path = require('path');
const fs = require('fs');

const UPGRADES = [
  {
    id: 'product-units',
    // Unit-of-measure setup per product (see model ProductUnit).
    table: 'product_units',
    statements: [
      `CREATE TABLE "product_units" (
    "product_unit_id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "product_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "units_per" INTEGER NOT NULL,
    "is_base" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "product_units_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("product_id") ON DELETE CASCADE ON UPDATE CASCADE
)`,
      `CREATE UNIQUE INDEX "product_units_product_id_name_key" ON "product_units"("product_id", "name")`,
    ],
  },
  {
    id: 'user-permissions',
    // Per-user inventory capabilities an Admin can grant or take away
    // (see model UserPermission).
    table: 'user_permissions',
    statements: [
      `CREATE TABLE "user_permissions" (
    "user_permission_id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "permission" TEXT NOT NULL,
    "allowed" BOOLEAN NOT NULL,
    "updated_by_user_id" INTEGER,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "user_permissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("user_id") ON DELETE CASCADE ON UPDATE CASCADE
)`,
      `CREATE UNIQUE INDEX "user_permissions_user_id_permission_key" ON "user_permissions"("user_id", "permission")`,
    ],
  },
];

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * @param {object} opts
 * @param {string} opts.dbPath   the live database file
 * @param {{ $queryRawUnsafe: Function, $executeRawUnsafe: Function, $transaction: Function }} opts.prisma
 * @param {(msg: string) => void} [opts.log]
 * @returns {Promise<{ applied: string[], backup: string | null }>}
 */
async function upgradeDatabase({ dbPath, prisma, log = console.log }) {
  const rows = await prisma.$queryRawUnsafe(`SELECT name FROM sqlite_master WHERE type = 'table'`);
  const existing = new Set(rows.map((r) => r.name));
  const pending = UPGRADES.filter((u) => !existing.has(u.table));
  if (pending.length === 0) return { applied: [], backup: null };

  // A safety copy first: this is the one moment the file's structure changes.
  const backupDir = path.join(path.dirname(dbPath), 'pre-upgrade-backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const backup = path.join(backupDir, `custom-${timestamp()}.db`);
  fs.copyFileSync(dbPath, backup);
  log(`Upgrading the database for this version (a copy of the old one is in ${path.relative(path.dirname(path.dirname(dbPath)), backup)})...`);

  for (const upgrade of pending) {
    // All of one upgrade's statements together, or none of them.
    await prisma.$transaction(upgrade.statements.map((sql) => prisma.$executeRawUnsafe(sql)));
    log(`  added: ${upgrade.id}`);
  }
  return { applied: pending.map((u) => u.id), backup };
}

module.exports = { upgradeDatabase, UPGRADES };
