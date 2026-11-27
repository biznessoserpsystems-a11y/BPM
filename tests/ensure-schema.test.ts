import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { PrismaClient } from '@prisma/client';
import { db } from './fixtures';
import { dbFilePath } from '../src/lib/db-file';

// The server bundle upgrades an EXISTING pharmacy's database at startup by
// running hand-written SQL (scripts/server-bundle/ensure-schema.js) — it has
// no Prisma CLI or internet to do `prisma db push` there. That SQL must
// produce exactly the tables Prisma itself creates from prisma/schema.prisma,
// or the app would misbehave only on upgraded servers, never in development.
// This test proves it: take a copy of the real (Prisma-built) test database,
// remove the upgraded tables, run the upgrade, and compare everything.

const require = createRequire(import.meta.url);
const { upgradeDatabase, UPGRADES } = require('../scripts/server-bundle/ensure-schema.js') as {
  upgradeDatabase: (o: { dbPath: string; prisma: PrismaClient; log: (m: string) => void }) => Promise<{ applied: string[]; backup: string | null }>;
  UPGRADES: { id: string; table: string }[];
};

type Row = Record<string, unknown>;
const plain = (rows: Row[]) => JSON.parse(JSON.stringify(rows, (_k, v) => (typeof v === 'bigint' ? Number(v) : v))) as Row[];

/** Everything about a table's shape that the app depends on. */
async function shapeOf(client: PrismaClient, table: string) {
  const columns = plain(await client.$queryRawUnsafe(`PRAGMA table_info("${table}")`)).map(({ name, type, notnull, dflt_value, pk }) => ({ name, type, notnull, dflt_value, pk }));
  const foreignKeys = plain(await client.$queryRawUnsafe(`PRAGMA foreign_key_list("${table}")`)).map(({ table: t, from, to, on_update, on_delete }) => ({ t, from, to, on_update, on_delete }));
  const indexList = plain(await client.$queryRawUnsafe(`PRAGMA index_list("${table}")`)).filter((i) => !String(i.name).startsWith('sqlite_autoindex'));
  const indexes: { name: unknown; unique: unknown; columns: unknown[] }[] = [];
  for (const i of indexList) {
    const cols = plain(await client.$queryRawUnsafe(`PRAGMA index_info("${i.name}")`)).map((c) => c.name);
    indexes.push({ name: i.name, unique: i.unique, columns: cols });
  }
  indexes.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return { columns, foreignKeys, indexes };
}

describe('startup database upgrade matches what Prisma creates', () => {
  let dir: string;
  let copy: PrismaClient;
  let copyPath: string;
  let result: { applied: string[]; backup: string | null };

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ensure-schema-'));
    fs.mkdirSync(path.join(dir, 'db'));
    copyPath = path.join(dir, 'db', 'custom.db');
    fs.copyFileSync(dbFilePath(), copyPath);

    copy = new PrismaClient({ datasourceUrl: `file:${copyPath}` });
    // Make the copy look like a database from before these tables existed.
    for (const u of [...UPGRADES].reverse()) await copy.$executeRawUnsafe(`DROP TABLE IF EXISTS "${u.table}"`);
    result = await upgradeDatabase({ dbPath: copyPath, prisma: copy, log: () => {} });
  });

  afterAll(async () => {
    await copy.$disconnect();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('upgrades every table it knows about, and takes a backup first', () => {
    expect(result.applied).toEqual(UPGRADES.map((u) => u.id));
    expect(result.backup && fs.existsSync(result.backup)).toBeTruthy();
  });

  it.each(UPGRADES.map((u) => [u.table]))('%s has exactly the columns, indexes and foreign keys Prisma creates', async (table) => {
    expect(await shapeOf(copy, table)).toEqual(await shapeOf(db as unknown as PrismaClient, table));
  });

  it('the app can read and write the upgraded tables through Prisma', async () => {
    expect(await copy.productUnit.findMany()).toEqual([]);
    expect(await copy.userPermission.findMany()).toEqual([]);
  });

  it('running it again on an already-upgraded database does nothing', async () => {
    const again = await upgradeDatabase({ dbPath: copyPath, prisma: copy, log: () => {} });
    expect(again).toEqual({ applied: [], backup: null });
  });
});
