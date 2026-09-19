// src/lib/audit-log.ts
import { db } from './db';

type TransactionClient = Parameters<Parameters<typeof db.$transaction>[0]>[0];

// A branchId is required on every audit log row, but not every event has
// a real branch to attribute (e.g. a failed login for an unknown
// username, before any user/branch is resolved) — 'SYSTEM' is a plain
// label for those, not a real Branch record, since this field carries no
// foreign-key relation to Branch.
export async function writeAuditLog(
  tx: TransactionClient | typeof db,
  params: {
    branchId?: string;
    userId?: number;
    action: string;
    entityName?: string;
    entityId?: string;
    ipAddress?: string;
    details?: Record<string, unknown>;
  }
) {
  await tx.systemAuditLog.create({
    data: {
      branchId: params.branchId ?? 'SYSTEM',
      userId: params.userId,
      action: params.action,
      entityName: params.entityName,
      entityId: params.entityId,
      ipAddress: params.ipAddress,
      details: params.details ? JSON.stringify(params.details) : null,
    },
  });
}
