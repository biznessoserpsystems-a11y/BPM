import type { AuthPayload } from '@/lib/auth';
import type { Prisma, PrismaClient } from '@prisma/client';

type Tx = PrismaClient | Prisma.TransactionClient;

/**
 * Whether `auth` is allowed to view/act on data for `branchId`.
 *
 * Admin and Manager have cross-branch oversight by design (same convention
 * already established for Approval Workflow defaults and period close/
 * reopen — see src/lib/approval.ts). Employees are confined to their own
 * home branch: someone logged in at one branch has no legitimate reason
 * to view another branch's sales, inventory, or financial reports,
 * without this check the client-supplied `branchId` query parameter was
 * trusted with no verification at all.
 *
 * Async because it now also verifies the branch actually belongs to the
 * caller's own company — this was previously missing entirely. Before
 * this, an Admin/Manager (who bypass the same-branch check below) could
 * pass any real branchId from ANY company on a shared deployment and
 * this function would return true, since it never checked which company
 * owned that branch in the first place. On a deployment now genuinely
 * running more than one real company, that gap was reachable by anyone
 * who had — or guessed — another company's branch ID.
 *
 * Deliberately narrow in scope: this governs single-branch *visibility*
 * (dashboard, reports, inventory, warehouse, audit log). Routes where a
 * resource inherently spans two branches (Inter-Branch Transfers) need
 * their own resource-specific checks instead of a single branchId gate,
 * since "which branch" isn't a single well-defined value for those.
 */
export async function canAccessBranch(tx: Tx, auth: AuthPayload, branchId: string): Promise<boolean> {
  const branch = await tx.branch.findUnique({ where: { id: branchId }, select: { companyId: true } });
  if (!branch || branch.companyId !== auth.companyId) return false;

  if (auth.roleName === 'ADMIN' || auth.roleName === 'MANAGER') return true;
  return auth.homeBranchId === branchId;
}

/**
 * Every branch ID belonging to the caller's own company — the correct
 * scope for a "combined, all branches" report view (branchId omitted),
 * as opposed to no filter at all. Several report routes previously used
 * an unscoped query in this case, which on a multi-company deployment
 * meant "all branches across every company in the database," not "all
 * of my company's branches."
 */
export async function getCompanyBranchIds(tx: Tx, companyId: string): Promise<string[]> {
  const branches = await tx.branch.findMany({ where: { companyId }, select: { id: true } });
  return branches.map((b) => b.id);
}
