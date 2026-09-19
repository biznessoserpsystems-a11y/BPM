import { NextRequest, NextResponse } from 'next/server';
import { writeFile, copyFile, mkdir } from 'fs/promises';
import path from 'path';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError, requireRole } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit-log';
import { db } from '@/lib/db';

const CAN_MANAGE_BACKUP = ['ADMIN'];

// First 16 bytes of every valid SQLite database file.
const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'utf8');

function dbFilePath(): string {
  return path.join(process.cwd(), 'db', 'custom.db');
}

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const roleError = requireRole(auth, CAN_MANAGE_BACKUP);
    if (roleError) return roleError;

    const formData = await request.formData().catch(() => null);
    const file = formData?.get('backupFile');
    if (!file || !(file instanceof File)) {
      throw new PharmacyServiceError('backupFile is required (multipart/form-data upload)');
    }

    const uploadedBytes = Buffer.from(await file.arrayBuffer());

    if (uploadedBytes.length < 16 || !uploadedBytes.subarray(0, 16).equals(SQLITE_HEADER)) {
      throw new PharmacyServiceError(
        'That file is not a valid SQLite database — restore only accepts .db backups downloaded from this same app'
      );
    }

    const dbPath = dbFilePath();

    // Record the restore *before* swapping the file, so this entry lands in
    // the still-current (about-to-be-replaced) database rather than trying
    // to write into the file mid-swap. It's expected that this specific
    // entry won't appear in the restored database afterward — that's the
    // nature of reverting to an earlier snapshot, not a bug.
    await writeAuditLog(db, {
      userId: auth.userId,
      action: 'RESTORE_BACKUP',
      entityName: 'Database',
      details: { uploadedSizeBytes: uploadedBytes.length, uploadedFileName: file.name },
    });

    // Safety net: keep a copy of whatever was live immediately before this
    // restore, in case the uploaded file turns out to be bad in a way the
    // header check above can't catch (e.g. a backup from an incompatible
    // schema version).
    const backupDir = path.join(process.cwd(), 'db', 'pre-restore-backups');
    await mkdir(backupDir, { recursive: true });
    const safetyPath = path.join(backupDir, `pre-restore-${Date.now()}.db`);
    await copyFile(dbPath, safetyPath);

    await writeFile(dbPath, uploadedBytes);

    return NextResponse.json({
      success: true,
      message: 'Database restored. Restart the server for all connections to pick up the restored data cleanly.',
    });
  } catch (error) {
    return handleApiError(error);
  }
}
