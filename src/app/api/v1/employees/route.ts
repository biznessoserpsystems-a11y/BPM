import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError, requireRole } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit-log';
import { encryptFieldIfPresent, decryptFieldIfPresent } from '@/lib/field-encryption';
import type { CreateEmployeeInput } from '@/types/pharmacy';

// Payroll data (salary, bank details, SSNIT/TIN numbers) is some of the
// most sensitive data in this app — same tier as Access Control and GL
// Mappings, not open to every role the way viewing a product catalog is.
const CAN_MANAGE_PAYROLL = ['ADMIN', 'MANAGER'];

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const roleError = requireRole(auth, CAN_MANAGE_PAYROLL);
    if (roleError) return roleError;

    const employees = await db.employee.findMany({
      where: { companyId: auth.companyId },
      orderBy: { fullName: 'asc' },
      include: { user: { select: { id: true, username: true } } },
    });

    // Decrypted here, at the one place every employee list read passes
    // through, rather than at each individual call site — the fields
    // are encrypted at rest (see field-encryption.ts) but every
    // authorized caller of this route still needs the real values, same
    // as before encryption existed.
    const decrypted = employees.map((emp) => ({
      ...emp,
      ssnitNumber: decryptFieldIfPresent(emp.ssnitNumber),
      tinNumber: decryptFieldIfPresent(emp.tinNumber),
      bankAccountNo: decryptFieldIfPresent(emp.bankAccountNo),
    }));

    return NextResponse.json(decrypted);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const roleError = requireRole(auth, CAN_MANAGE_PAYROLL);
    if (roleError) return roleError;

    const body: CreateEmployeeInput = await request.json();

    if (!body.employeeCode || !body.fullName || body.basicSalary == null || !body.employmentDate) {
      throw new PharmacyServiceError('employeeCode, fullName, basicSalary, and employmentDate are required');
    }
    if (body.basicSalary < 0) {
      throw new PharmacyServiceError('basicSalary cannot be negative');
    }

    const existing = await db.employee.findUnique({
      where: { companyId_employeeCode: { companyId: auth.companyId, employeeCode: body.employeeCode } },
    });
    if (existing) {
      throw new PharmacyServiceError(`Employee code "${body.employeeCode}" already exists`);
    }

    if (body.userId) {
      const alreadyLinked = await db.employee.findUnique({ where: { userId: body.userId } });
      if (alreadyLinked) {
        throw new PharmacyServiceError('That user is already linked to another employee record');
      }
      const user = await db.user.findUnique({ where: { id: body.userId } });
      if (!user || user.companyId !== auth.companyId) {
        throw new PharmacyServiceError('User not found in your company');
      }
    }

    const employee = await db.employee.create({
      data: {
        companyId: auth.companyId,
        employeeCode: body.employeeCode,
        fullName: body.fullName,
        ssnitNumber: encryptFieldIfPresent(body.ssnitNumber),
        tinNumber: encryptFieldIfPresent(body.tinNumber),
        bankName: body.bankName,
        bankAccountNo: encryptFieldIfPresent(body.bankAccountNo),
        basicSalary: body.basicSalary,
        allowances: body.allowances ?? 0,
        employmentDate: new Date(body.employmentDate),
        userId: body.userId,
      },
    });

    // Salary is logged in full — it's already visible to anyone with
    // Payroll access, same tier as this route itself. SSNIT/TIN/bank
    // account are deliberately left out of the audit trail entirely,
    // not just the changed value — logging that identity/financial
    // identifiers exist and were "changed" would still narrow what an
    // attacker with audit-log access could target, without much
    // legitimate accountability benefit over just having the record.
    await writeAuditLog(db, {
      branchId: auth.homeBranchId,
      userId: auth.userId,
      action: 'EMPLOYEE_CREATED',
      entityName: 'Employee',
      entityId: employee.id,
      details: { employeeCode: employee.employeeCode, fullName: employee.fullName, basicSalary: employee.basicSalary },
    });

    return NextResponse.json(
      {
        ...employee,
        ssnitNumber: decryptFieldIfPresent(employee.ssnitNumber),
        tinNumber: decryptFieldIfPresent(employee.tinNumber),
        bankAccountNo: decryptFieldIfPresent(employee.bankAccountNo),
      },
      { status: 201 }
    );
  } catch (error) {
    return handleApiError(error);
  }
}
