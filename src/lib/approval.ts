import type { Prisma, PrismaClient } from '@prisma/client';

type Tx = PrismaClient | Prisma.TransactionClient;

/** Used whenever no active ApprovalRule covers a given amount — including
 *  when nothing has been configured for this entity type at all. Keeps
 *  approval safely gated by default rather than accidentally wide open
 *  just because Settings → Approval Workflow hasn't been touched yet. */
const DEFAULT_APPROVER_ROLES = ['ADMIN', 'MANAGER'];

/**
 * Returns the role(s) allowed to approve an entity of the given type at the
 * given amount, based on configured tiers (Settings → Approval Workflow).
 * ADMIN can always approve regardless of what this returns — see
 * `canApprove` below — this only resolves the *additional* role(s) a rule
 * grants for that amount tier.
 */
export async function resolveRequiredApprovalRoles(
  tx: Tx,
  entityType: string,
  amount: number
): Promise<string[]> {
  const rules = await tx.approvalRule.findMany({
    where: {
      entityType,
      isActive: true,
      minAmount: { lte: amount },
      OR: [{ maxAmount: null }, { maxAmount: { gte: amount } }],
    },
  });

  if (rules.length === 0) {
    return DEFAULT_APPROVER_ROLES;
  }

  return rules.map((r) => r.requiredRole);
}

/** ADMIN is always a valid approver, on top of whatever the resolved tier requires. */
export function canApprove(roleName: string, requiredRoles: string[]): boolean {
  return roleName === 'ADMIN' || requiredRoles.includes(roleName);
}
