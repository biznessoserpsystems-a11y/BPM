import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError } from '@/lib/auth';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ rxItemId: string }> }
) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const { rxItemId } = await params;
    const rxItem = await db.prescriptionItem.findUnique({
      where: { id: rxItemId },
      include: {
        product: true,
        prescription: true,
        refillLogs: {
          include: {
            dispensedByUser: { select: { id: true, fullName: true, username: true } },
            sale: { include: { saleItems: { include: { product: true } } } },
          },
          orderBy: { dispensedDate: 'desc' },
        },
      },
    });

    if (!rxItem) {
      throw new PharmacyServiceError('Prescription item not found');
    }

    return NextResponse.json(rxItem);
  } catch (error) {
    return handleApiError(error);
  }
}
