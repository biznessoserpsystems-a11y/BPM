import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError, requireRole } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit-log';
import { db } from '@/lib/db';
import { dbFilePath } from '@/lib/db-file';

const CAN_MANAGE_BACKUP = ['ADMIN'];

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const roleError = requireRole(auth, CAN_MANAGE_BACKUP);
    if (roleError) return roleError;

    let fileBuffer: Buffer;
    try {
      fileBuffer = await readFile(dbFilePath());
    } catch {
      throw new PharmacyServiceError('Could not read the database file on the server');
    }

    await writeAuditLog(db, {
      userId: auth.userId,
      action: 'DOWNLOAD_BACKUP',
      entityName: 'Database',
      details: { sizeBytes: fileBuffer.length },
    });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    return new NextResponse(new Uint8Array(fileBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/x-sqlite3',
        'Content-Disposition': `attachment; filename="pharmacycare-backup-${timestamp}.db"`,
        'Content-Length': String(fileBuffer.length),
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
