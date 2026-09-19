import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError } from '@/lib/auth';
import { canAccessBranch } from '@/lib/branch-access';

const HISTORY_LIMIT = 100;

interface HistoryEntry {
  type: 'SALE' | 'RECEIPT' | 'ADJUSTMENT' | 'TRANSFER_OUT' | 'TRANSFER_IN';
  date: Date;
  quantityChange: number; // signed: positive = stock increased, negative = decreased
  reference: string;
  detail: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const { productId: productIdParam } = await params;
    const productId = Number(productIdParam);
    const branchId = request.nextUrl.searchParams.get('branchId');

    if (!branchId) {
      throw new PharmacyServiceError('branchId query parameter is required');
    }
    if (!(await canAccessBranch(db, auth, branchId))) {
      throw new PharmacyServiceError('You do not have access to this branch\'s data');
    }
    if (!Number.isInteger(productId) || productId <= 0) {
      throw new PharmacyServiceError('A valid productId is required');
    }

    const product = await db.product.findUnique({ where: { id: productId } });
    if (!product || product.companyId !== auth.companyId) {
      throw new PharmacyServiceError('Product not found');
    }

    const batches = await db.productBatch.findMany({
      where: { productId, branchId },
      orderBy: { expiryDate: 'asc' },
      include: { supplier: { select: { name: true } } },
    });

    const [saleItems, adjustments, receiptItems, transfersOut, transfersIn] = await Promise.all([
      db.saleItem.findMany({
        where: { productId, sale: { branchId } },
        include: { sale: { select: { invoiceNumber: true, saleDate: true, customerName: true } } },
        orderBy: { sale: { saleDate: 'desc' } },
        take: HISTORY_LIMIT,
      }),
      db.stockAdjustment.findMany({
        where: { productId, branchId },
        orderBy: { createdAt: 'desc' },
        take: HISTORY_LIMIT,
      }),
      db.goodsReceiptItem.findMany({
        where: { productId, goodsReceipt: { branchId } },
        include: { goodsReceipt: { select: { grnNumber: true, receivedDate: true, purchaseOrder: { select: { poNumber: true } } } } },
        orderBy: { goodsReceipt: { receivedDate: 'desc' } },
        take: HISTORY_LIMIT,
      }),
      db.interBranchTransfer.findMany({
        where: { productId, sourceBranchId: branchId, status: { in: ['APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED'] } },
        orderBy: { updatedAt: 'desc' },
        take: HISTORY_LIMIT,
      }),
      db.interBranchTransfer.findMany({
        where: { productId, destinationBranchId: branchId, status: 'RECEIVED' },
        orderBy: { updatedAt: 'desc' },
        take: HISTORY_LIMIT,
      }),
    ]);

    const history: HistoryEntry[] = [
      ...saleItems.map((s): HistoryEntry => ({
        type: 'SALE',
        date: s.sale.saleDate,
        quantityChange: -s.quantity,
        reference: s.sale.invoiceNumber,
        detail: `Sold to ${s.sale.customerName || 'Walk-in Customer'}`,
      })),
      ...adjustments.map((a): HistoryEntry => ({
        type: 'ADJUSTMENT',
        date: a.createdAt,
        quantityChange: a.quantityChanged,
        reference: a.id.slice(0, 8),
        detail: a.reason + (a.notes ? ` — ${a.notes}` : ''),
      })),
      ...receiptItems.map((r): HistoryEntry => ({
        type: 'RECEIPT',
        date: r.goodsReceipt.receivedDate,
        quantityChange: r.quantityReceived,
        reference: r.goodsReceipt.grnNumber,
        detail: `Received against ${r.goodsReceipt.purchaseOrder.poNumber}`,
      })),
      ...transfersOut.map((t): HistoryEntry => ({
        type: 'TRANSFER_OUT',
        date: t.updatedAt,
        quantityChange: -t.approvedQty,
        reference: t.transferCode,
        detail: `Transferred to branch ${t.destinationBranchId}`,
      })),
      ...transfersIn.map((t): HistoryEntry => ({
        type: 'TRANSFER_IN',
        date: t.updatedAt,
        quantityChange: t.approvedQty,
        reference: t.transferCode,
        detail: `Received from branch ${t.sourceBranchId}`,
      })),
    ]
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, HISTORY_LIMIT);

    return NextResponse.json({ product, batches, history });
  } catch (error) {
    return handleApiError(error);
  }
}
