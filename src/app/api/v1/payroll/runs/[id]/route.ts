import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError, requireRole } from '@/lib/auth';

const CAN_PROCESS_PAYROLL = ['ADMIN', 'MANAGER'];

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const roleError = requireRole(auth, CAN_PROCESS_PAYROLL);
    if (roleError) return roleError;

    const { id } = await params;
    const payRun = await db.payRun.findUnique({
      where: { id },
      include: {
        lines: { include: { employee: { select: { employeeCode: true, fullName: true } } } },
        processedByUser: { select: { id: true, fullName: true } },
      },
    });
    if (!payRun || payRun.companyId !== auth.companyId) {
      throw new PharmacyServiceError('Pay run not found');
    }

    return NextResponse.json(payRun);
  } catch (error) {
    return handleApiError(error);
  }
}
