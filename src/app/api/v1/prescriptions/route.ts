import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import type { CreatePrescriptionInput } from '@/types/pharmacy';
import { getAuthPayload, isAuthError } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const search = request.nextUrl.searchParams.get('search');

    const where = search
      ? {
          OR: [
            { patientName: { contains: search } },
            { rxNumber: { contains: search } },
          ],
        }
      : {};

    const prescriptions = await db.prescription.findMany({
      where,
      include: {
        items: {
          include: { product: true, refillLogs: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(prescriptions);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const body: CreatePrescriptionInput = await request.json();

    if (!body.patientName || !body.doctorName || !body.doctorLicenseNumber || !body.expiryDate || !body.items?.length) {
      throw new PharmacyServiceError(
        'patientName, doctorName, doctorLicenseNumber, expiryDate, and items are required'
      );
    }

    // Generate RX number
    const rxCount = await db.prescription.count();
    const rxNumber = `RX-${String(rxCount + 1).padStart(6, '0')}`;

    const prescription = await db.prescription.create({
      data: {
        rxNumber,
        patientName: body.patientName,
        patientPhone: body.patientPhone,
        doctorName: body.doctorName,
        doctorLicenseNumber: body.doctorLicenseNumber,
        expiryDate: new Date(body.expiryDate),
        notes: body.notes,
        items: {
          create: body.items.map((item) => ({
            productId: item.productId,
            dosageInstructions: item.dosageInstructions,
            refillsAuthorized: item.refillsAuthorized,
            refillsRemaining: item.refillsAuthorized,
            quantityPerRefill: item.quantityPerRefill,
            intervalDays: item.intervalDays ?? 30,
          })),
        },
      },
      include: {
        items: { include: { product: true } },
      },
    });

    return NextResponse.json(prescription, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
