// src/types/pharmacy.ts

export interface SaleItemInput {
  productId: number;
  batchId: string;
  quantity: number;
  unitPrice: number;
}

export interface CreateSaleInput {
  branchId: string;
  userId: number;
  customerName?: string;
  customerPhone?: string;
  doctorName?: string;
  rxItemId?: string;
  discountAmount?: number;
  taxAmount?: number;
  paymentMethod: string;
  items: SaleItemInput[];
}

export interface CreateTransferInput {
  sourceBranchId: string;
  destinationBranchId: string;
  productId: number;
  requestedQty: number;
  requestedByUserId: number;
}

export interface ApproveTransferInput {
  transferId: string;
  sourceBatchId: string;
  approvedQty: number;
  approvedByUserId: number;
}

export interface LoginInput {
  username: string;
  password: string;
}

export interface CreateUserInput {
  username: string;
  password: string;
  fullName: string;
  email?: string;
  phone?: string;
  roleId: number;
  homeBranchId?: string;
  licenseNumber?: string;
}

export interface UpdateUserInput {
  fullName?: string;
  email?: string;
  phone?: string;
  homeBranchId?: string;
  licenseNumber?: string;
  isActive?: boolean;
  roleId?: number;
}

export interface CreateProductInput {
  skuCode: string;
  barcode?: string;
  brandName: string;
  genericName: string;
  category: string;
  dosageForm: string;
  strength?: string;
  reorderLevel?: number;
  isControlledSubstance?: boolean;
  isPrescriptionRequired?: boolean;
  taxRate?: number;
}

export interface UpdateProductInput {
  brandName?: string;
  genericName?: string;
  category?: string;
  dosageForm?: string;
  strength?: string;
  reorderLevel?: number;
  isControlledSubstance?: boolean;
  isPrescriptionRequired?: boolean;
  taxRate?: number;
}

export interface CreateSupplierInput {
  name: string;
  contactPerson?: string;
  phone: string;
  email?: string;
  address?: string;
  apAccountId?: number;
}

export interface UpdateSupplierInput {
  name?: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  isActive?: boolean;
  apAccountId?: number | null;
}

export interface ReceiveBatchInput {
  branchId: string;
  productId: number;
  supplierId?: number;
  batchNumber: string;
  expiryDate: string;
  purchasePrice: number;
  sellingPrice: number;
  quantityReceived: number;
  receivedByUserId: number;
}

export interface PrescriptionItemInput {
  productId: number;
  dosageInstructions: string;
  refillsAuthorized: number;
  quantityPerRefill: number;
  intervalDays?: number;
}

export interface CreatePrescriptionInput {
  patientName: string;
  patientPhone?: string;
  doctorName: string;
  doctorLicenseNumber: string;
  expiryDate: string;
  notes?: string;
  items: PrescriptionItemInput[];
}

export interface UpdatePrescriptionItemInput {
  id: string;
  dosageInstructions?: string;
  refillsAuthorized?: number;
  quantityPerRefill?: number;
  intervalDays?: number;
}

export interface UpdatePrescriptionInput {
  patientName?: string;
  patientPhone?: string;
  doctorName?: string;
  doctorLicenseNumber?: string;
  expiryDate?: string;
  notes?: string;
  status?: string; // ACTIVE | CANCELLED
  items?: UpdatePrescriptionItemInput[];
}

export interface CreateStockAdjustmentInput {
  branchId: string;
  batchId: string;
  productId: number;
  userId: number;
  quantityChanged: number;
  reason: string;
  notes?: string;
}

export interface AuditLogFilter {
  branchId?: string;
  userId?: number;
  entityName?: string;
  limit?: number;
}

// =============================================================================
// PROCUREMENT: PURCHASE ORDERS & GOODS RECEIPT
// =============================================================================

export interface PurchaseOrderItemInput {
  productId: number;
  quantityOrdered: number;
  unitCost: number;
  taxRate?: number;
}

export interface CreatePurchaseOrderInput {
  branchId: string;
  supplierId: number;
  requestedByUserId: number;
  currencyId?: number;
  exchangeRate?: number;
  expectedDeliveryDate?: string;
  notes?: string;
  items: PurchaseOrderItemInput[];
}

// Full replace of line items — only allowed while the PO is still DRAFT.
export interface UpdatePurchaseOrderInput {
  supplierId?: number;
  expectedDeliveryDate?: string;
  notes?: string;
  items?: PurchaseOrderItemInput[];
}

export interface ApprovePurchaseOrderInput {
  approvedByUserId: number;
}

export interface CancelPurchaseOrderInput {
  cancelledByUserId: number;
  reason: string;
}

export interface GoodsReceiptItemInput {
  purchaseOrderItemId: string;
  batchNumber: string;
  expiryDate: string;
  quantityReceived: number;
  unitCost?: number; // defaults to the PO item's agreed unitCost
  sellingPrice: number;
}

export interface ReceivePurchaseOrderInput {
  branchId: string;
  receivedByUserId: number;
  notes?: string;
  items: GoodsReceiptItemInput[];
}

// =============================================================================
// ACCOUNTING: CURRENCY, CHART OF ACCOUNTS, GENERAL LEDGER
// =============================================================================

export interface CreateCurrencyInput {
  code: string;
  name: string;
  symbol: string;
  decimalPlaces?: number;
}

export interface CreateAccountInput {
  accountCode: string;
  accountName: string;
  accountType: string; // ASSET | LIABILITY | EQUITY | REVENUE | EXPENSE
  accountSubType?: string;
  normalBalance: string; // DEBIT | CREDIT
  parentAccountId?: number;
}

export interface UpdateAccountInput {
  accountCode?: string;
  accountName?: string;
  accountType?: string;
  accountSubType?: string;
  normalBalance?: string;
  parentAccountId?: number | null;
  isActive?: boolean;
}

export interface JournalLineInput {
  accountId: number;
  debit?: number;
  credit?: number;
  description?: string;
  productId?: number;
}

export interface CreateJournalEntryInput {
  branchId: string;
  entryDate: string;
  description?: string;
  sourceType: string;
  sourceId?: string;
  currencyId?: number; // defaults to base currency
  exchangeRate?: number; // defaults to 1.0
  postedByUserId: number;
  lines: JournalLineInput[];
}

// =============================================================================
// IFRS MODULES: FIXED ASSETS, LEASES, REVENUE RECOGNITION, INVENTORY VALUATION
// =============================================================================

export interface CreateFixedAssetInput {
  assetCode: string;
  assetName: string;
  category: string;
  branchId: string;
  acquisitionDate: string;
  acquisitionCost: number;
  residualValue?: number;
  usefulLifeMonths: number;
  depreciationMethod?: string;
  assetAccountId?: number;
  accumulatedDepreciationAccountId?: number;
  depreciationExpenseAccountId?: number;
}

export interface CreateLeaseInput {
  leaseCode: string;
  branchId: string;
  description: string;
  lessor: string;
  startDate: string;
  endDate: string;
  monthlyPayment: number;
  discountRate: number;
  rouAssetValue: number;
  leaseLiability: number;
  rouAssetAccountId?: number;
  leaseLiabilityAccountId?: number;
}

export interface CreateRevenueContractInput {
  contractCode: string;
  branchId: string;
  customerName: string;
  saleId?: string;
  totalContractValue: number;
  recognizedRevenue?: number;
  recognitionMethod?: string;
  startDate: string;
  endDate?: string;
  deferredRevenueAccountId?: number;
}

export interface CreateInventoryValuationInput {
  batchId: string;
  costPerUnit: number;
  netRealizableValue: number;
  quantityOnHand: number;
  reason?: string;
}

// =============================================================================
// SETTINGS: PROFILE, SECURITY, GL MAPPINGS
// =============================================================================

export interface UpdateProfileInput {
  fullName?: string;
  email?: string;
  phone?: string;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

export interface SetGLMappingInput {
  mappingKey: string;
  accountId: number;
}

export interface CreateApprovalRuleInput {
  entityType: string;
  minAmount?: number;
  maxAmount?: number | null;
  requiredRole: string;
  description?: string;
}

export interface UpdateApprovalRuleInput {
  minAmount?: number;
  maxAmount?: number | null;
  requiredRole?: string;
  description?: string;
  isActive?: boolean;
}

export interface CreatePermissionInput {
  permissionName: string;
  description?: string;
}

export interface UpdateUserAccessInput {
  roleId?: number;
  isActive?: boolean;
}

export interface CreateUserInput {
  username: string;
  password: string;
  fullName: string;
  email?: string;
  phone?: string;
  roleId: number;
  homeBranchId?: string;
  licenseNumber?: string;
}

export interface AdminResetPasswordInput {
  newPassword: string;
}

export interface CreateExchangeRateInput {
  currencyId: number;
  rateDate: string; // ISO date
  rateToBase: number; // 1 unit of this currency = X GHS
  source?: string; // MANUAL | API — defaults to MANUAL
}

export interface CreateSalesReturnInput {
  items: { saleItemId: string; quantity: number }[];
  reason?: string;
  restocked: boolean;
}

export interface CreateEmployeeInput {
  employeeCode: string;
  fullName: string;
  ssnitNumber?: string;
  tinNumber?: string;
  bankName?: string;
  bankAccountNo?: string;
  basicSalary: number;
  allowances?: number;
  employmentDate: string;
  userId?: number;
}

export interface UpdateEmployeeInput extends Partial<CreateEmployeeInput> {
  isActive?: boolean;
}

export interface CreatePayeTaxBandInput {
  minAmount: number;
  maxAmount: number | null;
  ratePct: number;
  sortOrder: number;
}

export interface UpdatePayrollSettingsInput {
  ssnitEmployeePct?: number;
  ssnitEmployerPct?: number;
  ssnitCeiling?: number | null;
}

export interface CreatePayRunInput {
  periodStart: string;
  periodEnd: string;
  payDate: string;
  branchId?: string;
  employeeAdjustments?: { employeeId: string; otherDeductions?: number }[];
}
