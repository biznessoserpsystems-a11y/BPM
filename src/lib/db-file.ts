import path from 'path';

/**
 * Absolute path of the SQLite file the app is actually using, derived from
 * DATABASE_URL — the same setting Prisma itself reads — so Backup/Restore
 * always operate on the real database, wherever it lives.
 *
 * The old code hardcoded `<cwd>/db/custom.db`. That only holds when the
 * server is started from the project root. The offline server bundle runs
 * the app from its `app/` subfolder while the live database sits one level
 * up (`<bundle>/db/custom.db`), so Backup failed with "Could not read the
 * database file on the server" and Restore couldn't find what to replace.
 *
 * Forms handled:
 *  - absolute, e.g. the server bundle's `file:C:\BiznessPhOS-Server\db\custom.db`
 *  - relative, e.g. dev's `file:../db/custom.db` — Prisma resolves these
 *    against the folder holding schema.prisma (`prisma/`), not the cwd
 *  - missing/unrecognised: falls back to the old `<cwd>/db/custom.db`
 */
export function dbFilePath(): string {
  const url = process.env.DATABASE_URL ?? '';
  if (url.startsWith('file:')) {
    let p = url.slice('file:'.length).split('?')[0];
    // file:///C:/... style — drop the leading slashes before the drive letter
    p = p.replace(/^\/+(?=[A-Za-z]:[\\/])/, '');
    if (p) {
      return path.isAbsolute(p) ? path.normalize(p) : path.resolve(process.cwd(), 'prisma', p);
    }
  }
  return path.join(process.cwd(), 'db', 'custom.db');
}

/** Folder that holds the live database file (e.g. for pre-restore safety copies). */
export function dbDirPath(): string {
  return path.dirname(dbFilePath());
}
