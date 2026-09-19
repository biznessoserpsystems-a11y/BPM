import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError, requireRole } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit-log';
import type { UpdatePrescriptionInput } from '@/types/pharmacy';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ rxNumber: string }> }
) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const { rxNumber } = await params;
    const prescription = await db.prescription.findUnique({
      where: { rxNumber },
      include: {
        items: {
          include: {
            product: true,
            refillLogs: {
              include: { dispensedByUser: { select: { id: true, fullName: true, username: true } }, sale: true },
              orderBy: { dispensedDate: 'desc' },
            },
          },
        },
      },
    });

    if (!prescription) {
      throw new PharmacyServiceError('Prescription not found');
    }

    return NextResponse.json(prescription);
  } catch (error) {
    return handleApiError(error);
  }
}

// Editing refill terms (how many refills, how much per refill) is a
// clinical/accountability decision, same tier as recording a stock
// adjustment — Technicians can create and dispense against a
// prescription, but not change its terms after the fact.
const CAN_EDIT_PRESCRIPTION = ['ADMIN', 'MANAGER', 'EMPLOYEE'];

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ rxNumber: string }> }
) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const roleError = requireRole(auth, CAN_EDIT_PRESCRIPTION);
    if (roleError) return roleError;

    const { rxNumber } = await params;
    const body: UpdatePrescriptionInput = await request.json();

    const existing = await db.prescription.findUnique({
      where: { rxNumber },
      include: { items: true },
    });
    if (!existing) {
      throw new PharmacyServiceError('Prescription not found');
    }

    if (body.status && !['ACTIVE', 'CANCELLED'].includes(body.status)) {
      throw new PharmacyServiceError('status must be ACTIVE or CANCELLED');
    }
    if (body.expiryDate && Number.isNaN(new Date(body.expiryDate).getTime())) {
      throw new PharmacyServiceError('expiryDate is not a valid date');
    }

    const updated = await db.$transaction(async (tx) => {
      if (body.items?.length) {
        for (const itemUpdate of body.items) {
          const existingItem = existing.items.find((i) => i.id === itemUpdate.id);
          if (!existingItem) {
            throw new PharmacyServiceError(`Item ${itemUpdate.id} does not belong to this prescription`);
          }

          if (itemUpdate.refillsAuthorized !== undefined) {
            // A refill already dispensed is real history — refillsAuthorized
            // can be reduced (e.g. the doctor cut the order short), but never
            // below what's already been given out.
            const alreadyUsed = existingItem.refillsAuthorized - existingItem.refillsRemaining;
            if (itemUpdate.refillsAuthorized < alreadyUsed) {
              throw new PharmacyServiceError(
                `Cannot set refillsAuthorized to ${itemUpdate.refillsAuthorized} — ${alreadyUsed} refill${alreadyUsed === 1 ? '' : 's'} already dispensed against this item`
              );
            }
          }

          await tx.prescriptionItem.update({
            where: { id: itemUpdate.id },
            data: {
              dosageInstructions: itemUpdate.dosageInstructions,
              quantityPerRefill: itemUpdate.quantityPerRefill,
              intervalDays: itemUpdate.intervalDays,
              // Keep refillsRemaining in step with the new authorized count,
              // preserving however many have already been used.
              ...(itemUpdate.refillsAuthorized !== undefined
                ? {
                    refillsAuthorized: itemUpdate.refillsAuthorized,
                    refillsRemaining: itemUpdate.refillsAuthorized - (existingItem.refillsAuthorized - existingItem.refillsRemaining),
                  }
                : {}),
            },
          });
        }
      }

      return tx.prescription.update({
        where: { rxNumber },
        data: {
          patientName: body.patientName,
          patientPhone: body.patientPhone,
          doctorName: body.doctorName,
          doctorLicenseNumber: body.doctorLicenseNumber,
          expiryDate: body.expiryDate ? new Date(body.expiryDate) : undefined,
          notes: body.notes,
          status: body.status,
        },
        include: { items: { include: { product: true } } },
      });
    });

    await writeAuditLog(db, {
      userId: auth.userId,
      action: 'UPDATE_PRESCRIPTION',
      entityName: 'Prescription',
      entityId: existing.id,
      details: { rxNumber, changedFields: Object.keys(body) },
    });

    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}

// Hard-deleting a prescription is a more permanent action than editing
// it, so held to a tighter tier — same as restoring a backup or
// reconfiguring GL mappings.
const CAN_DELETE_PRESCRIPTION = ['ADMIN', 'MANAGER'];

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ rxNumber: string }> }
) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const roleError = requireRole(auth, CAN_DELETE_PRESCRIPTION);
    if (roleError) return roleError;

    const { rxNumber } = await params;
    const existing = await db.prescription.findUnique({
      where: { rxNumber },
      include: { items: { include: { refillLogs: true } } },
    });
    if (!existing) {
      throw new PharmacyServiceError('Prescription not found');
    }

    const hasDispensingHistory = existing.items.some((i) => i.refillLogs.length > 0);
    if (hasDispensingHistory) {
      throw new PharmacyServiceError(
        'This prescription has real dispensing/sales history against it and cannot be deleted — cancel it instead (PATCH status: "CANCELLED") to stop further refills without destroying that record.'
      );
    }

    await db.prescription.delete({ where: { rxNumber } });

    await writeAuditLog(db, {
      userId: auth.userId,
      action: 'DELETE_PRESCRIPTION',
      entityName: 'Prescription',
      entityId: existing.id,
      details: { rxNumber, patientName: existing.patientName },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
