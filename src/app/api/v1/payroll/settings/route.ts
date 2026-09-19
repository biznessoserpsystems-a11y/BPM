import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError, requireRole } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit-log';
import type { UpdatePayrollSettingsInput } from '@/types/pharmacy';

const CAN_MANAGE_PAYROLL = ['ADMIN', 'MANAGER'];

// Reasonable starting defaults if a company has never configured this —
// same "commonly-cited baseline, verify against current SSNIT guidance"
// caveat as everything else in this module. Returned, not silently
// created, so GET never has an unintended side effect.
const DEFAULT_SSNIT_EMPLOYEE_PCT = 5.5;
const DEFAULT_SSNIT_EMPLOYER_PCT = 13;

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const roleError = requireRole(auth, CAN_MANAGE_PAYROLL);
    if (roleError) return roleError;

    const settings = await db.payrollSettings.findUnique({ where: { companyId: auth.companyId } });

    return NextResponse.json(
      settings ?? {
        companyId: auth.companyId,
        ssnitEmployeePct: DEFAULT_SSNIT_EMPLOYEE_PCT,
        ssnitEmployerPct: DEFAULT_SSNIT_EMPLOYER_PCT,
        ssnitCeiling: null,
        isDefault: true,
      }
    );
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const roleError = requireRole(auth, CAN_MANAGE_PAYROLL);
    if (roleError) return roleError;

    const body: UpdatePayrollSettingsInput = await request.json();

    if (body.ssnitEmployeePct != null && (body.ssnitEmployeePct < 0 || body.ssnitEmployeePct > 100)) {
      throw new PharmacyServiceError('ssnitEmployeePct must be between 0 and 100');
    }
    if (body.ssnitEmployerPct != null && (body.ssnitEmployerPct < 0 || body.ssnitEmployerPct > 100)) {
      throw new PharmacyServiceError('ssnitEmployerPct must be between 0 and 100');
    }

    const updated = await db.payrollSettings.upsert({
      where: { companyId: auth.companyId },
      update: {
        ssnitEmployeePct: body.ssnitEmployeePct,
        ssnitEmployerPct: body.ssnitEmployerPct,
        ssnitCeiling: body.ssnitCeiling,
      },
      create: {
        companyId: auth.companyId,
        ssnitEmployeePct: body.ssnitEmployeePct ?? DEFAULT_SSNIT_EMPLOYEE_PCT,
        ssnitEmployerPct: body.ssnitEmployerPct ?? DEFAULT_SSNIT_EMPLOYER_PCT,
        ssnitCeiling: body.ssnitCeiling,
      },
    });

    // Rates, not PII — every pay run computed from here on is affected,
    // so this is worth a full, plain audit entry, unlike an individual
    // employee's own numbers.
    await writeAuditLog(db, {
      branchId: auth.homeBranchId,
      userId: auth.userId,
      action: 'PAYROLL_SETTINGS_UPDATED',
      entityName: 'PayrollSettings',
      entityId: String(updated.id),
      details: {
        ssnitEmployeePct: updated.ssnitEmployeePct,
        ssnitEmployerPct: updated.ssnitEmployerPct,
        ssnitCeiling: updated.ssnitCeiling,
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
