import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { getAuthPayload, isAuthError } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const patientPhone = request.nextUrl.searchParams.get('patientPhone');

    const where: Record<string, unknown> = {
      status: 'ACTIVE',
      items: {
        some: {
          refillsRemaining: { gt: 0 },
        },
      },
      expiryDate: { gte: new Date() },
    };

    if (patientPhone) {
      where.patientPhone = patientPhone;
    }

    const prescriptions = await db.prescription.findMany({
      where,
      include: {
        items: {
          include: { product: true, refillLogs: true },
          where: { refillsRemaining: { gt: 0 } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(prescriptions);
  } catch (error) {
    return handleApiError(error);
  }
}
