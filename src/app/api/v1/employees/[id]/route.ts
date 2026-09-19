import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError, requireRole } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit-log';
import { encryptFieldIfPresent, decryptFieldIfPresent } from '@/lib/field-encryption';
import type { UpdateEmployeeInput } from '@/types/pharmacy';

const CAN_MANAGE_PAYROLL = ['ADMIN', 'MANAGER'];

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const roleError = requireRole(auth, CAN_MANAGE_PAYROLL);
    if (roleError) return roleError;

    const { id } = await params;
    const body: UpdateEmployeeInput = await request.json();

    const existing = await db.employee.findUnique({ where: { id } });
    if (!existing || existing.companyId !== auth.companyId) {
      throw new PharmacyServiceError('Employee not found');
    }
    if (body.basicSalary != null && body.basicSalary < 0) {
      throw new PharmacyServiceError('basicSalary cannot be negative');
    }

    // Decrypted once, up front, so the "did this actually change?" check
    // below compares plaintext to plaintext — comparing the incoming
    // plaintext body value directly against the stored ciphertext would
    // report every single update as a change, encrypted or not.
    const existingPlain = {
      ssnitNumber: decryptFieldIfPresent(existing.ssnitNumber),
      tinNumber: decryptFieldIfPresent(existing.tinNumber),
      bankAccountNo: decryptFieldIfPresent(existing.bankAccountNo),
    };

    const updated = await db.employee.update({
      where: { id },
      data: {
        fullName: body.fullName,
        ssnitNumber: encryptFieldIfPresent(body.ssnitNumber),
        tinNumber: encryptFieldIfPresent(body.tinNumber),
        bankName: body.bankName,
        bankAccountNo: encryptFieldIfPresent(body.bankAccountNo),
        basicSalary: body.basicSalary,
        allowances: body.allowances,
        employmentDate: body.employmentDate ? new Date(body.employmentDate) : undefined,
        isActive: body.isActive,
      },
    });

    // Salary changes are logged with real before/after values — useful,
    // legitimate accountability information ("who gave themselves a
    // raise"), and no more sensitive than what Payroll already shows.
    // SSNIT/TIN/bank account are logged only as field NAMES that
    // changed, never the values — this is deliberately still present
    // (unlike the create log, which omits them entirely) because
    // knowing *that* an employee's bank account was silently changed is
    // exactly the kind of signal that catches internal fraud, without
    // the audit trail itself becoming a second place those numbers live.
    const sensitiveFieldsChanged: string[] = (['ssnitNumber', 'tinNumber', 'bankAccountNo'] as const).filter(
      (field) => body[field] !== undefined && body[field] !== existingPlain[field]
    );
    if (body.bankName !== undefined && body.bankName !== existing.bankName) {
      sensitiveFieldsChanged.push('bankName');
    }
    await writeAuditLog(db, {
      branchId: auth.homeBranchId,
      userId: auth.userId,
      action: 'EMPLOYEE_UPDATED',
      entityName: 'Employee',
      entityId: updated.id,
      details: {
        employeeCode: updated.employeeCode,
        fullName: updated.fullName,
        ...(body.basicSalary != null && body.basicSalary !== existing.basicSalary
          ? { previousSalary: existing.basicSalary, newSalary: body.basicSalary }
          : {}),
        ...(sensitiveFieldsChanged.length > 0 ? { sensitiveFieldsChanged } : {}),
        ...(body.isActive != null && body.isActive !== existing.isActive ? { isActiveChangedTo: body.isActive } : {}),
      },
    });

    return NextResponse.json({
      ...updated,
      ssnitNumber: decryptFieldIfPresent(updated.ssnitNumber),
      tinNumber: decryptFieldIfPresent(updated.tinNumber),
      bankAccountNo: decryptFieldIfPresent(updated.bankAccountNo),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const roleError = requireRole(auth, CAN_MANAGE_PAYROLL);
    if (roleError) return roleError;

    const { id } = await params;
    const existing = await db.employee.findUnique({
      where: { id },
      include: { payslipLines: { take: 1 } },
    });
    if (!existing || existing.companyId !== auth.companyId) {
      throw new PharmacyServiceError('Employee not found');
    }
    if (existing.payslipLines.length > 0) {
      throw new PharmacyServiceError(
        'This employee has real payslip history and cannot be deleted — deactivate them instead to stop future pay runs without destroying that record.'
      );
    }

    await db.employee.delete({ where: { id } });

    await writeAuditLog(db, {
      branchId: auth.homeBranchId,
      userId: auth.userId,
      action: 'EMPLOYEE_DELETED',
      entityName: 'Employee',
      entityId: existing.id,
      details: { employeeCode: existing.employeeCode, fullName: existing.fullName },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
