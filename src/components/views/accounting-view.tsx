'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { TileTabsList, TileTabsTrigger } from '@/components/ui/tile-tabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Landmark,
  BookText,
  Coins,
  Building,
  KeySquare,
  Receipt,
  PackageMinus,
  Plus,
  Trash2,
  CheckCircle2,
  CalendarClock,
  Lock,
  LockOpen,
  Scale,
  ArrowLeftRight,
  TrendingDown,
  BadgeCheck,
  CreditCard as CreditCardIcon,
  Pencil,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { usePharmacyStore } from '@/lib/store';
import { formatMoney } from '@/lib/currency';
import { fetchJson } from '@/lib/fetch-json';
import { ErrorBanner, errorMessage } from '@/components/ui/error-banner';

// =============================================================================
// TYPES
// =============================================================================

interface Currency {
  id: number;
  code: string;
  name: string;
  symbol: string;
  isBaseCurrency: boolean;
  isActive: boolean;
}

interface ExchangeRateRow {
  id: number;
  currencyId: number;
  rateDate: string;
  rateToBase: number;
  source: string;
  currency: { code: string; name: string; symbol: string };
}

interface Account {
  id: number;
  accountCode: string;
  accountName: string;
  accountType: string;
  accountSubType?: string;
  normalBalance: string;
  isActive: boolean;
}

interface JournalLine {
  id: string;
  accountId: number;
  debit: number;
  credit: number;
  description?: string;
  account: { accountCode: string; accountName: string };
}

interface JournalEntryRow {
  id: string;
  entryNumber: string;
  branchId: string;
  entryDate: string;
  description?: string;
  sourceType: string;
  status: string;
  currency: Currency;
  postedByUser: { fullName: string };
  lines: JournalLine[];
}

interface FixedAssetRow {
  id: string;
  assetCode: string;
  assetName: string;
  category: string;
  branchId: string;
  acquisitionCost: number;
  usefulLifeMonths: number;
  status: string;
}

interface LeaseRow {
  id: string;
  leaseCode: string;
  description: string;
  lessor: string;
  monthlyPayment: number;
  rouAssetValue: number;
  leaseLiability: number;
  status: string;
}

interface RevenueContractRow {
  id: string;
  contractCode: string;
  customerName: string;
  totalContractValue: number;
  recognizedRevenue: number;
  deferredRevenue: number;
  recognitionMethod: string;
  status: string;
}

interface AccountingPeriodRow {
  id: number;
  periodName: string;
  startDate: string;
  endDate: string;
  status: string;
  closedAt?: string;
  closedByUser?: { fullName: string } | null;
}

interface TrialBalanceLine {
  accountId: number;
  accountCode: string;
  accountName: string;
  accountType: string;
  debitBalance: number;
  creditBalance: number;
}

interface TrialBalanceReport {
  asOfDate: string;
  rows: TrialBalanceLine[];
  totalDebits: number;
  totalCredits: number;
  difference: number;
  isBalanced: boolean;
}

interface InventoryValuationRow {
  id: string;
  valuationDate: string;
  costPerUnit: number;
  netRealizableValue: number;
  quantityOnHand: number;
  writeDownRequired: boolean;
  writeDownAmount: number;
  reason?: string;
  batch: { batchNumber: string; product: { brandName: string } };
}

// =============================================================================
// COMPONENT
// =============================================================================

export function AccountingView() {
  const queryClient = useQueryClient();
  const { user, selectedBranchId } = usePharmacyStore();

  const { data: currencies = [], isLoading: currenciesLoading, isError: currenciesError, error: currenciesErrorObj } = useQuery<Currency[]>({
    queryKey: ['currencies'],
    queryFn: () => fetchJson<Currency[]>('/api/v1/currencies'),
  });

  const { data: accounts = [], isLoading: accountsLoading, isError: accountsError, error: accountsErrorObj } = useQuery<Account[]>({
    queryKey: ['accounts'],
    queryFn: () => fetchJson<Account[]>('/api/v1/accounts'),
  });

  const { data: journalEntries = [], isLoading: journalLoading, isError: journalError, error: journalErrorObj } = useQuery<JournalEntryRow[]>({
    queryKey: ['journal-entries'],
    queryFn: () => fetchJson<JournalEntryRow[]>('/api/v1/journal-entries'),
  });

  const { data: fixedAssets = [], isLoading: assetsLoading, isError: assetsError, error: assetsErrorObj } = useQuery<FixedAssetRow[]>({
    queryKey: ['fixed-assets'],
    queryFn: () => fetchJson<FixedAssetRow[]>('/api/v1/fixed-assets'),
  });

  const { data: leases = [], isLoading: leasesLoading, isError: leasesError, error: leasesErrorObj } = useQuery<LeaseRow[]>({
    queryKey: ['leases'],
    queryFn: () => fetchJson<LeaseRow[]>('/api/v1/leases'),
  });

  const { data: revenueContracts = [], isLoading: contractsLoading, isError: contractsError, error: contractsErrorObj } = useQuery<RevenueContractRow[]>({
    queryKey: ['revenue-contracts'],
    queryFn: () => fetchJson<RevenueContractRow[]>('/api/v1/revenue-contracts'),
  });

  const { data: valuations = [], isLoading: valuationsLoading, isError: valuationsError, error: valuationsErrorObj } = useQuery<InventoryValuationRow[]>({
    queryKey: ['inventory-valuations'],
    queryFn: () => fetchJson<InventoryValuationRow[]>('/api/v1/inventory-valuations'),
  });

  const { data: periods = [], isLoading: periodsLoading, isError: periodsError, error: periodsErrorObj } = useQuery<AccountingPeriodRow[]>({
    queryKey: ['accounting-periods'],
    queryFn: () => fetchJson<AccountingPeriodRow[]>('/api/v1/accounting-periods'),
  });

  const [trialBalanceDate, setTrialBalanceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const { data: trialBalance, isLoading: trialBalanceLoading, isError: trialBalanceError, error: trialBalanceErrorObj } = useQuery<TrialBalanceReport>({
    queryKey: ['trial-balance', trialBalanceDate],
    queryFn: () => fetchJson<TrialBalanceReport>(`/api/v1/reports/trial-balance?asOfDate=${trialBalanceDate}`),
  });

  const baseCurrency = currencies.find((c) => c.isBaseCurrency);

  // ---------------------------------------------------------------------------
  // Currency
  // ---------------------------------------------------------------------------

  const [currencyOpen, setCurrencyOpen] = useState(false);
  const [currencyForm, setCurrencyForm] = useState({ code: '', name: '', symbol: '' });

  const currencyMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetchJson('/api/v1/currencies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success('Currency added!');
      setCurrencyOpen(false);
      setCurrencyForm({ code: '', name: '', symbol: '' });
      queryClient.invalidateQueries({ queryKey: ['currencies'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setBaseMutation = useMutation({
    mutationFn: (id: number) => fetchJson(`/api/v1/currencies/${id}/set-base`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('Base currency updated');
      queryClient.invalidateQueries({ queryKey: ['currencies'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ---------------------------------------------------------------------------
  // Exchange Rates
  // ---------------------------------------------------------------------------

  const canManageExchangeRates = user?.roleName === 'ADMIN' || user?.roleName === 'MANAGER';

  const { data: exchangeRates = [], isLoading: ratesLoading, isError: ratesError, error: ratesErrorObj } = useQuery<ExchangeRateRow[]>({
    queryKey: ['exchange-rates'],
    queryFn: () => fetchJson<ExchangeRateRow[]>('/api/v1/exchange-rates'),
  });

  const [rateOpen, setRateOpen] = useState(false);
  const [rateForm, setRateForm] = useState({
    currencyId: '',
    rateDate: new Date().toISOString().slice(0, 10),
    rateToBase: '',
  });

  const rateMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetchJson('/api/v1/exchange-rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success('Exchange rate recorded!');
      setRateOpen(false);
      setRateForm({ currencyId: '', rateDate: new Date().toISOString().slice(0, 10), rateToBase: '' });
      queryClient.invalidateQueries({ queryKey: ['exchange-rates'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteRateMutation = useMutation({
    mutationFn: (id: number) => fetchJson(`/api/v1/exchange-rates/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Exchange rate deleted');
      queryClient.invalidateQueries({ queryKey: ['exchange-rates'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const nonBaseCurrencies = currencies.filter((c) => !c.isBaseCurrency);

  // ---------------------------------------------------------------------------
  // Chart of Accounts
  // ---------------------------------------------------------------------------

  const [accountOpen, setAccountOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [accountForm, setAccountForm] = useState({
    accountCode: '',
    accountName: '',
    accountType: 'ASSET',
    accountSubType: '',
    normalBalance: 'DEBIT',
  });

  const openEditAccount = (a: Account) => {
    setEditingAccount(a);
    setAccountForm({
      accountCode: a.accountCode,
      accountName: a.accountName,
      accountType: a.accountType,
      accountSubType: a.accountSubType || '',
      normalBalance: a.normalBalance,
    });
    setAccountOpen(true);
  };

  const accountMutation = useMutation({
    mutationFn: ({ body, method, id }: { body: Record<string, unknown>; method: string; id?: number }) =>
      fetchJson(method === 'PATCH' ? `/api/v1/accounts/${id}` : '/api/v1/accounts', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: (_, vars) => {
      toast.success(vars.method === 'PATCH' ? 'Account updated!' : 'Account added!');
      setAccountOpen(false);
      setEditingAccount(null);
      setAccountForm({ accountCode: '', accountName: '', accountType: 'ASSET', accountSubType: '', normalBalance: 'DEBIT' });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ---------------------------------------------------------------------------
  // Journal Entries
  // ---------------------------------------------------------------------------

  const [journalOpen, setJournalOpen] = useState(false);
  const [journalDesc, setJournalDesc] = useState('');
  const [journalSourceType, setJournalSourceType] = useState('MANUAL');
  const [lines, setLines] = useState<{ accountId: string; debit: string; credit: string }[]>([
    { accountId: '', debit: '', credit: '' },
    { accountId: '', debit: '', credit: '' },
  ]);

  const totalDebit = lines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0);
  const isBalanced = lines.length >= 2 && totalDebit > 0 && Math.abs(totalDebit - totalCredit) < 0.005;

  const journalMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetchJson<{ entryNumber: string }>('/api/v1/journal-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: (data) => {
      toast.success(`Journal entry ${data.entryNumber} posted!`);
      setJournalOpen(false);
      setJournalDesc('');
      setJournalSourceType('MANUAL');
      setLines([{ accountId: '', debit: '', credit: '' }, { accountId: '', debit: '', credit: '' }]);
      queryClient.invalidateQueries({ queryKey: ['journal-entries'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handlePostJournal = () => {
    if (!isBalanced) {
      toast.error('Entry must be balanced (total debits = total credits) before posting');
      return;
    }
    const validLines = lines.filter((l) => l.accountId && (Number(l.debit) > 0 || Number(l.credit) > 0));
    if (validLines.length < 2) {
      toast.error('Add at least two complete lines');
      return;
    }
    journalMutation.mutate({
      branchId: selectedBranchId,
      entryDate: new Date().toISOString(),
      description: journalDesc || undefined,
      sourceType: journalSourceType,
      postedByUserId: user?.id,
      lines: validLines.map((l) => ({
        accountId: Number(l.accountId),
        debit: Number(l.debit) || 0,
        credit: Number(l.credit) || 0,
      })),
    });
  };

  const addLine = () => setLines((ls) => [...ls, { accountId: '', debit: '', credit: '' }]);
  const removeLine = (idx: number) => setLines((ls) => ls.filter((_, i) => i !== idx));
  const updateLine = (idx: number, field: 'accountId' | 'debit' | 'credit', value: string) =>
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));

  // ---------------------------------------------------------------------------
  // Fixed Assets, Leases, Revenue Contracts, Inventory Valuations
  // (lighter-weight forms — read-focused, with a simple add dialog each)
  // ---------------------------------------------------------------------------

  const [assetOpen, setAssetOpen] = useState(false);
  const [assetForm, setAssetForm] = useState({
    assetCode: '', assetName: '', category: '', acquisitionDate: '', acquisitionCost: '', usefulLifeMonths: '',
  });
  const assetMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetchJson('/api/v1/fixed-assets', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success('Fixed asset added!');
      setAssetOpen(false);
      setAssetForm({ assetCode: '', assetName: '', category: '', acquisitionDate: '', acquisitionCost: '', usefulLifeMonths: '' });
      queryClient.invalidateQueries({ queryKey: ['fixed-assets'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [leaseOpen, setLeaseOpen] = useState(false);
  const [leaseForm, setLeaseForm] = useState({
    leaseCode: '', description: '', lessor: '', startDate: '', endDate: '', monthlyPayment: '', discountRate: '', rouAssetValue: '', leaseLiability: '',
  });
  const leaseMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetchJson('/api/v1/leases', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success('Lease added!');
      setLeaseOpen(false);
      setLeaseForm({ leaseCode: '', description: '', lessor: '', startDate: '', endDate: '', monthlyPayment: '', discountRate: '', rouAssetValue: '', leaseLiability: '' });
      queryClient.invalidateQueries({ queryKey: ['leases'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [contractOpen, setContractOpen] = useState(false);
  const [contractForm, setContractForm] = useState({
    contractCode: '', customerName: '', totalContractValue: '', recognitionMethod: 'OVER_TIME', startDate: '',
  });
  const contractMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetchJson('/api/v1/revenue-contracts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success('Revenue contract added!');
      setContractOpen(false);
      setContractForm({ contractCode: '', customerName: '', totalContractValue: '', recognitionMethod: 'OVER_TIME', startDate: '' });
      queryClient.invalidateQueries({ queryKey: ['revenue-contracts'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ---------------------------------------------------------------------------
  // Period-driven postings: depreciation, lease payments, revenue recognition.
  // One shared dialog handles all three, since each just needs "which period"
  // plus (for revenue recognition only) an amount.
  // ---------------------------------------------------------------------------

  const [periodActionTarget, setPeriodActionTarget] = useState<
    { kind: 'depreciate'; asset: FixedAssetRow } | { kind: 'lease-payment'; lease: LeaseRow } | { kind: 'recognize'; contract: RevenueContractRow } | null
  >(null);
  const [periodActionPeriodId, setPeriodActionPeriodId] = useState('');
  const [recognizeAmount, setRecognizeAmount] = useState('');

  const depreciateMutation = useMutation({
    mutationFn: ({ assetId, periodId }: { assetId: string; periodId: number }) =>
      fetchJson(`/api/v1/fixed-assets/${assetId}/depreciate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ periodId }),
      }),
    onSuccess: () => {
      toast.success('Depreciation posted!');
      closePeriodActionDialog();
      queryClient.invalidateQueries({ queryKey: ['fixed-assets'] });
      queryClient.invalidateQueries({ queryKey: ['journal-entries'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const leasePaymentMutation = useMutation({
    mutationFn: ({ leaseId, periodId }: { leaseId: string; periodId: number }) =>
      fetchJson(`/api/v1/leases/${leaseId}/payments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ periodId }),
      }),
    onSuccess: () => {
      toast.success('Lease payment posted!');
      closePeriodActionDialog();
      queryClient.invalidateQueries({ queryKey: ['leases'] });
      queryClient.invalidateQueries({ queryKey: ['journal-entries'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const recognizeRevenueMutation = useMutation({
    mutationFn: ({ contractId, periodId, recognizedAmount }: { contractId: string; periodId: number; recognizedAmount: number }) =>
      fetchJson(`/api/v1/revenue-contracts/${contractId}/recognize`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ periodId, recognizedAmount }),
      }),
    onSuccess: () => {
      toast.success('Revenue recognized!');
      closePeriodActionDialog();
      queryClient.invalidateQueries({ queryKey: ['revenue-contracts'] });
      queryClient.invalidateQueries({ queryKey: ['journal-entries'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const closePeriodActionDialog = () => {
    setPeriodActionTarget(null);
    setPeriodActionPeriodId('');
    setRecognizeAmount('');
  };

  const handlePeriodActionSubmit = () => {
    if (!periodActionTarget || !periodActionPeriodId) { toast.error('Select an accounting period'); return; }
    const periodId = Number(periodActionPeriodId);
    if (periodActionTarget.kind === 'depreciate') {
      depreciateMutation.mutate({ assetId: periodActionTarget.asset.id, periodId });
    } else if (periodActionTarget.kind === 'lease-payment') {
      leasePaymentMutation.mutate({ leaseId: periodActionTarget.lease.id, periodId });
    } else {
      const amount = Number(recognizeAmount);
      if (!amount || amount <= 0) { toast.error('Enter a positive amount to recognize'); return; }
      recognizeRevenueMutation.mutate({ contractId: periodActionTarget.contract.id, periodId, recognizedAmount: amount });
    }
  };

  const periodActionPending = depreciateMutation.isPending || leasePaymentMutation.isPending || recognizeRevenueMutation.isPending;

  // ---------------------------------------------------------------------------
  // Accounting Periods
  // ---------------------------------------------------------------------------

  const closePeriodMutation = useMutation({
    mutationFn: (periodId: number) =>
      fetchJson(`/api/v1/accounting-periods/${periodId}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user?.id }),
      }),
    onSuccess: () => {
      toast.success('Period closed');
      queryClient.invalidateQueries({ queryKey: ['accounting-periods'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reopenPeriodMutation = useMutation({
    mutationFn: (periodId: number) =>
      fetchJson(`/api/v1/accounting-periods/${periodId}/reopen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user?.id, reason: 'Reopened from Accounting > Periods' }),
      }),
    onSuccess: () => {
      toast.success('Period reopened');
      queryClient.invalidateQueries({ queryKey: ['accounting-periods'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canManagePeriods = user?.roleName === 'ADMIN' || user?.roleName === 'MANAGER';

  return (
    <Tabs defaultValue="accounts" className="space-y-4">
      <TileTabsList>
        <TileTabsTrigger value="accounts" icon={Landmark} label="Chart of Accounts" color="brand" />
        <TileTabsTrigger value="journal" icon={BookText} label="Journal Entries" color="sky" />
        <TileTabsTrigger value="payments" icon={CreditCardIcon} label="Payments" color="rose" />
        <TileTabsTrigger value="currencies" icon={Coins} label="Currencies" color="amber" />
        <TileTabsTrigger value="exchange-rates" icon={ArrowLeftRight} label="Exchange Rates" color="orange" />
        <TileTabsTrigger value="assets" icon={Building} label="Fixed Assets" color="slate" />
        <TileTabsTrigger value="leases" icon={KeySquare} label="Leases" color="violet" />
        <TileTabsTrigger value="revenue" icon={Receipt} label="Revenue" color="teal" />
        <TileTabsTrigger value="valuations" icon={PackageMinus} label="Valuations" color="rose" />
        <TileTabsTrigger value="periods" icon={CalendarClock} label="Periods" color="brand" />
      </TileTabsList>

      {/* Chart of Accounts */}
      <TabsContent value="accounts">
        <Card>
          <CardHeader className="pb-3 flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Landmark className="h-4 w-4 text-brand-600" /> Chart of Accounts
            </CardTitle>
            <Dialog
              open={accountOpen}
              onOpenChange={(open) => {
                setAccountOpen(open);
                if (!open) {
                  setEditingAccount(null);
                  setAccountForm({ accountCode: '', accountName: '', accountType: 'ASSET', accountSubType: '', normalBalance: 'DEBIT' });
                }
              }}
            >
              <DialogTrigger asChild>
                <Button size="sm" className="bg-brand-600 hover:bg-brand-700"><Plus className="h-4 w-4 mr-1" /> Add Account</Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader><DialogTitle>{editingAccount ? 'Edit' : 'Add'} Account</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Account Code *</Label>
                      <Input className="h-9" placeholder="1000" value={accountForm.accountCode} onChange={(e) => setAccountForm((f) => ({ ...f, accountCode: e.target.value }))} />
                    </div>
                    <div>
                      <Label className="text-xs">Account Name *</Label>
                      <Input className="h-9" placeholder="Cash" value={accountForm.accountName} onChange={(e) => setAccountForm((f) => ({ ...f, accountName: e.target.value }))} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Account Type *</Label>
                      <Select value={accountForm.accountType} onValueChange={(v) => setAccountForm((f) => ({ ...f, accountType: v, normalBalance: ['ASSET', 'EXPENSE'].includes(v) ? 'DEBIT' : 'CREDIT' }))}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Normal Balance *</Label>
                      <Select value={accountForm.normalBalance} onValueChange={(v) => setAccountForm((f) => ({ ...f, normalBalance: v }))}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="DEBIT">DEBIT</SelectItem>
                          <SelectItem value="CREDIT">CREDIT</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Sub-type</Label>
                    <Input className="h-9" placeholder="CURRENT_ASSET" value={accountForm.accountSubType} onChange={(e) => setAccountForm((f) => ({ ...f, accountSubType: e.target.value }))} />
                  </div>
                  {editingAccount && (
                    <p className="text-[10px] text-muted-foreground">
                      Changing Account Type or Normal Balance is only allowed if this account has never had a journal line posted to it — otherwise it would silently reinterpret past reports.
                    </p>
                  )}
                  <Button
                    className="w-full bg-brand-600 hover:bg-brand-700"
                    disabled={accountMutation.isPending}
                    onClick={() => {
                      if (!accountForm.accountCode || !accountForm.accountName) { toast.error('Account code and name are required'); return; }
                      const body = { ...accountForm, accountSubType: accountForm.accountSubType || undefined };
                      if (editingAccount) {
                        accountMutation.mutate({ body, method: 'PATCH', id: editingAccount.id });
                      } else {
                        accountMutation.mutate({ body, method: 'POST' });
                      }
                    }}
                  >
                    {accountMutation.isPending ? 'Saving...' : 'Save Account'}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent className="p-0">
            {accountsError ? (
              <ErrorBanner message={accountsErrorObj instanceof Error ? accountsErrorObj.message : 'Unknown error'} />
            ) : accountsLoading ? (
              <div className="p-6 space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : accounts.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>Sub-type</TableHead><TableHead>Normal Balance</TableHead><TableHead>Status</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {accounts.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="font-mono text-xs px-1.5 py-0.5 rounded bg-brand-50 text-brand-800 border border-brand-200">{a.accountCode}</TableCell>
                        <TableCell className="text-sm font-medium">{a.accountName}</TableCell>
                        <TableCell><Badge variant="secondary" className="text-xs">{a.accountType}</Badge></TableCell>
                        <TableCell className="text-xs text-muted-foreground">{a.accountSubType || '-'}</TableCell>
                        <TableCell className="text-xs">{a.normalBalance}</TableCell>
                        <TableCell>
                          <Badge variant={a.isActive ? 'default' : 'secondary'} className={cn('text-xs', a.isActive && 'bg-brand-100 text-brand-700')}>
                            {a.isActive ? 'Active' : 'Inactive'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => openEditAccount(a)}>
                            <Pencil className="h-3 w-3 mr-1" /> Edit
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="p-8 text-center"><Landmark className="h-10 w-10 mx-auto text-muted-foreground/30 mb-2" /><p className="text-sm text-muted-foreground">No accounts yet.</p></div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* Journal Entries */}
      <TabsContent value="journal">
        <Card>
          <CardHeader className="pb-3 flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <BookText className="h-4 w-4 text-brand-600" /> Journal Entries
            </CardTitle>
            <Dialog open={journalOpen} onOpenChange={setJournalOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="bg-brand-600 hover:bg-brand-700"><Plus className="h-4 w-4 mr-1" /> New Journal Entry</Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader><DialogTitle>New Journal Entry</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Source Type</Label>
                      <Select value={journalSourceType} onValueChange={setJournalSourceType}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {['MANUAL', 'SALE', 'STOCK_ADJUSTMENT', 'TRANSFER', 'PURCHASE'].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Description</Label>
                      <Input className="h-9" value={journalDesc} onChange={(e) => setJournalDesc(e.target.value)} />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">Lines</Label>
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={addLine}><Plus className="h-3 w-3 mr-1" /> Add Line</Button>
                    </div>
                    {lines.map((line, idx) => (
                      <div key={idx} className="grid grid-cols-[1fr_100px_100px_32px] gap-2 items-center">
                        <Select value={line.accountId} onValueChange={(v) => updateLine(idx, 'accountId', v)}>
                          <SelectTrigger className="h-9"><SelectValue placeholder="Account" /></SelectTrigger>
                          <SelectContent>
                            {accounts?.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.accountCode} — {a.accountName}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Input type="number" className="h-9" placeholder="Debit" value={line.debit} onChange={(e) => updateLine(idx, 'debit', e.target.value)} disabled={!!line.credit} />
                        <Input type="number" className="h-9" placeholder="Credit" value={line.credit} onChange={(e) => updateLine(idx, 'credit', e.target.value)} disabled={!!line.debit} />
                        <Button variant="ghost" size="icon" className="h-9 w-9 text-rose-600" onClick={() => removeLine(idx)} disabled={lines.length <= 2}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>

                  <div className={`flex items-center justify-between rounded-md border p-3 text-sm ${isBalanced ? 'border-brand-300 bg-brand-50' : 'border-amber-300 bg-amber-50'}`}>
                    <span>Total Debit: <strong>{formatMoney(totalDebit, baseCurrency?.symbol)}</strong></span>
                    <span>Total Credit: <strong>{formatMoney(totalCredit, baseCurrency?.symbol)}</strong></span>
                    {isBalanced ? (
                      <span className="flex items-center gap-1 text-brand-700"><CheckCircle2 className="h-4 w-4" /> Balanced</span>
                    ) : (
                      <span className="text-amber-700">Not balanced</span>
                    )}
                  </div>

                  <Button className="w-full bg-brand-600 hover:bg-brand-700" disabled={!isBalanced || journalMutation.isPending} onClick={handlePostJournal}>
                    {journalMutation.isPending ? 'Posting...' : 'Post Journal Entry'}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent className="p-0">
            {journalError ? (
              <ErrorBanner message={journalErrorObj instanceof Error ? journalErrorObj.message : 'Unknown error'} />
            ) : journalLoading ? (
              <div className="p-6 space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
            ) : journalEntries.length > 0 ? (
              <div className="divide-y">
                {journalEntries.map((entry) => (
                  <div key={entry.id} className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold px-1.5 py-0.5 rounded bg-brand-50 text-brand-800 border border-brand-200">{entry.entryNumber}</span>
                        <Badge variant="outline" className="text-[10px]">{entry.sourceType}</Badge>
                        <Badge variant="secondary" className="text-[10px]">{entry.currency.code}</Badge>
                      </div>
                      <span className="text-xs text-muted-foreground">{new Date(entry.entryDate).toLocaleDateString()} · {entry.postedByUser.fullName}</span>
                    </div>
                    {entry.description && <p className="text-xs text-muted-foreground mb-2">{entry.description}</p>}
                    <Table>
                      <TableBody>
                        {entry.lines.map((line) => (
                          <TableRow key={line.id} className="border-0">
                            <TableCell className="py-1 text-xs">{line.account.accountCode} — {line.account.accountName}</TableCell>
                            <TableCell className="py-1 text-xs text-right w-28">{line.debit > 0 ? formatMoney(line.debit, entry.currency.symbol) : ''}</TableCell>
                            <TableCell className="py-1 text-xs text-right w-28">{line.credit > 0 ? formatMoney(line.credit, entry.currency.symbol) : ''}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-8 text-center"><BookText className="h-10 w-10 mx-auto text-muted-foreground/30 mb-2" /><p className="text-sm text-muted-foreground">No journal entries yet.</p></div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* Payments */}
      <TabsContent value="payments">
        <PaymentsSection accounts={accounts} selectedBranchId={selectedBranchId} baseCurrency={baseCurrency} queryClient={queryClient} />
      </TabsContent>

      {/* Currencies */}
      <TabsContent value="currencies">
        <Card>
          <CardHeader className="pb-3 flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2"><Coins className="h-4 w-4 text-brand-600" /> Currencies</CardTitle>
            <Dialog open={currencyOpen} onOpenChange={setCurrencyOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="bg-brand-600 hover:bg-brand-700"><Plus className="h-4 w-4 mr-1" /> Add Currency</Button>
              </DialogTrigger>
              <DialogContent className="max-w-sm">
                <DialogHeader><DialogTitle>Add Currency</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs">ISO Code *</Label>
                    <Input className="h-9" placeholder="USD" maxLength={3} value={currencyForm.code} onChange={(e) => setCurrencyForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} />
                  </div>
                  <div>
                    <Label className="text-xs">Name *</Label>
                    <Input className="h-9" placeholder="US Dollar" value={currencyForm.name} onChange={(e) => setCurrencyForm((f) => ({ ...f, name: e.target.value }))} />
                  </div>
                  <div>
                    <Label className="text-xs">Symbol *</Label>
                    <Input className="h-9" placeholder="$" value={currencyForm.symbol} onChange={(e) => setCurrencyForm((f) => ({ ...f, symbol: e.target.value }))} />
                  </div>
                  <Button
                    className="w-full bg-brand-600 hover:bg-brand-700"
                    disabled={currencyMutation.isPending}
                    onClick={() => {
                      if (!currencyForm.code || !currencyForm.name || !currencyForm.symbol) { toast.error('All fields are required'); return; }
                      currencyMutation.mutate(currencyForm);
                    }}
                  >
                    {currencyMutation.isPending ? 'Saving...' : 'Save Currency'}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent className="p-0">
            {currenciesError ? (
              <ErrorBanner message={currenciesErrorObj instanceof Error ? currenciesErrorObj.message : 'Unknown error'} />
            ) : currenciesLoading ? (
              <div className="p-6 space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : currencies.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Symbol</TableHead><TableHead>Base?</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {currencies.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-mono text-xs px-1.5 py-0.5 rounded bg-brand-50 text-brand-800 border border-brand-200">{c.code}</TableCell>
                        <TableCell className="text-sm">{c.name}</TableCell>
                        <TableCell className="text-sm">{c.symbol}</TableCell>
                        <TableCell>{c.isBaseCurrency && <Badge className="bg-brand-100 text-brand-700 text-xs">Base Currency</Badge>}</TableCell>
                        <TableCell>
                          {!c.isBaseCurrency && c.code === 'GHS' && (
                            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setBaseMutation.mutate(c.id)} disabled={setBaseMutation.isPending}>
                              Set as Base
                            </Button>
                          )}
                          {!c.isBaseCurrency && c.code !== 'GHS' && (
                            <span className="text-[10px] text-muted-foreground">Base is fixed to GHS</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="p-8 text-center"><Coins className="h-10 w-10 mx-auto text-muted-foreground/30 mb-2" /><p className="text-sm text-muted-foreground">No currencies yet.</p></div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* Exchange Rates */}
      <TabsContent value="exchange-rates">
        <Card>
          <CardHeader className="pb-3 flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2"><ArrowLeftRight className="h-4 w-4 text-orange-600" /> Exchange Rates</CardTitle>
            {canManageExchangeRates ? (
              <Dialog open={rateOpen} onOpenChange={setRateOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="bg-orange-600 hover:bg-orange-700" disabled={nonBaseCurrencies.length === 0}>
                    <Plus className="h-4 w-4 mr-1" /> Record Rate
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-sm">
                  <DialogHeader><DialogTitle>Record Exchange Rate</DialogTitle></DialogHeader>
                  <div className="space-y-3">
                    <div>
                      <Label className="text-xs">Currency *</Label>
                      <Select value={rateForm.currencyId} onValueChange={(v) => setRateForm((f) => ({ ...f, currencyId: v }))}>
                        <SelectTrigger className="h-9"><SelectValue placeholder="Select currency" /></SelectTrigger>
                        <SelectContent>
                          {nonBaseCurrencies.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.code} — {c.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Date *</Label>
                      <Input type="date" className="h-9" value={rateForm.rateDate} onChange={(e) => setRateForm((f) => ({ ...f, rateDate: e.target.value }))} />
                    </div>
                    <div>
                      <Label className="text-xs">Rate to {baseCurrency?.code || 'GHS'} *</Label>
                      <Input
                        type="number"
                        step="0.0001"
                        min="0"
                        className="h-9"
                        placeholder="e.g. 15.42"
                        value={rateForm.rateToBase}
                        onChange={(e) => setRateForm((f) => ({ ...f, rateToBase: e.target.value }))}
                      />
                      <p className="text-[10px] text-muted-foreground mt-1">
                        1 unit of the selected currency = this many {baseCurrency?.code || 'GHS'}.
                      </p>
                    </div>
                    <Button
                      className="w-full bg-orange-600 hover:bg-orange-700"
                      disabled={!rateForm.currencyId || !rateForm.rateDate || !rateForm.rateToBase || rateMutation.isPending}
                      onClick={() => rateMutation.mutate({
                        currencyId: Number(rateForm.currencyId),
                        rateDate: rateForm.rateDate,
                        rateToBase: Number(rateForm.rateToBase),
                      })}
                    >
                      {rateMutation.isPending ? 'Saving...' : 'Save Rate'}
                    </Button>
                    <p className="text-[10px] text-muted-foreground">
                      Recording the same currency and date again updates the existing rate instead of duplicating it.
                    </p>
                  </div>
                </DialogContent>
              </Dialog>
            ) : (
              <span className="text-[10px] text-muted-foreground">Only Admin/Manager can record rates</span>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {ratesError ? (
              <ErrorBanner message={ratesErrorObj instanceof Error ? ratesErrorObj.message : 'Unknown error'} />
            ) : ratesLoading ? (
              <div className="p-6 space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : exchangeRates.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Currency</TableHead>
                      <TableHead>Rate to {baseCurrency?.code || 'GHS'}</TableHead>
                      <TableHead>Source</TableHead>
                      {canManageExchangeRates && <TableHead className="text-right">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {exchangeRates.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-sm">{new Date(r.rateDate).toLocaleDateString()}</TableCell>
                        <TableCell className="text-sm font-mono">{r.currency.code}</TableCell>
                        <TableCell className="text-sm">{r.rateToBase.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</TableCell>
                        <TableCell><Badge variant="secondary" className="text-[10px]">{r.source}</Badge></TableCell>
                        {canManageExchangeRates && (
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-rose-600"
                              onClick={() => deleteRateMutation.mutate(r.id)}
                              disabled={deleteRateMutation.isPending}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="p-8 text-center">
                <ArrowLeftRight className="h-10 w-10 mx-auto text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">
                  {nonBaseCurrencies.length === 0
                    ? 'Add a non-base currency first, then record rates for it here.'
                    : 'No exchange rates recorded yet.'}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* Fixed Assets */}
      <TabsContent value="assets">
        <Card>
          <CardHeader className="pb-3 flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2"><Building className="h-4 w-4 text-brand-600" /> Fixed Assets (IAS 16)</CardTitle>
            <Dialog open={assetOpen} onOpenChange={setAssetOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="bg-brand-600 hover:bg-brand-700"><Plus className="h-4 w-4 mr-1" /> Add Asset</Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader><DialogTitle>Add Fixed Asset</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label className="text-xs">Asset Code *</Label><Input className="h-9" value={assetForm.assetCode} onChange={(e) => setAssetForm((f) => ({ ...f, assetCode: e.target.value }))} /></div>
                    <div><Label className="text-xs">Category *</Label><Input className="h-9" placeholder="EQUIPMENT" value={assetForm.category} onChange={(e) => setAssetForm((f) => ({ ...f, category: e.target.value }))} /></div>
                  </div>
                  <div><Label className="text-xs">Asset Name *</Label><Input className="h-9" value={assetForm.assetName} onChange={(e) => setAssetForm((f) => ({ ...f, assetName: e.target.value }))} /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label className="text-xs">Acquisition Date *</Label><Input type="date" className="h-9" value={assetForm.acquisitionDate} onChange={(e) => setAssetForm((f) => ({ ...f, acquisitionDate: e.target.value }))} /></div>
                    <div><Label className="text-xs">Cost *</Label><Input type="number" className="h-9" value={assetForm.acquisitionCost} onChange={(e) => setAssetForm((f) => ({ ...f, acquisitionCost: e.target.value }))} /></div>
                  </div>
                  <div><Label className="text-xs">Useful Life (months) *</Label><Input type="number" className="h-9" value={assetForm.usefulLifeMonths} onChange={(e) => setAssetForm((f) => ({ ...f, usefulLifeMonths: e.target.value }))} /></div>
                  <Button
                    className="w-full bg-brand-600 hover:bg-brand-700"
                    disabled={assetMutation.isPending}
                    onClick={() => {
                      if (!assetForm.assetCode || !assetForm.assetName || !assetForm.category || !assetForm.acquisitionDate || !assetForm.acquisitionCost || !assetForm.usefulLifeMonths) { toast.error('All fields are required'); return; }
                      assetMutation.mutate({
                        ...assetForm,
                        branchId: selectedBranchId,
                        acquisitionCost: Number(assetForm.acquisitionCost),
                        usefulLifeMonths: Number(assetForm.usefulLifeMonths),
                      });
                    }}
                  >
                    {assetMutation.isPending ? 'Saving...' : 'Save Asset'}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent className="p-0">
            {assetsError ? (
              <ErrorBanner message={assetsErrorObj instanceof Error ? assetsErrorObj.message : 'Unknown error'} />
            ) : assetsLoading ? (
              <div className="p-6 space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : fixedAssets.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Category</TableHead><TableHead>Cost</TableHead><TableHead>Useful Life</TableHead><TableHead>Status</TableHead><TableHead>Action</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {fixedAssets.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="font-mono text-xs px-1.5 py-0.5 rounded bg-brand-50 text-brand-800 border border-brand-200">{a.assetCode}</TableCell>
                        <TableCell className="text-sm">{a.assetName}</TableCell>
                        <TableCell><Badge variant="secondary" className="text-xs">{a.category}</Badge></TableCell>
                        <TableCell className="text-sm">{formatMoney(a.acquisitionCost, baseCurrency?.symbol)}</TableCell>
                        <TableCell className="text-sm">{a.usefulLifeMonths} mo</TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">{a.status}</Badge></TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            disabled={a.status !== 'ACTIVE'}
                            onClick={() => setPeriodActionTarget({ kind: 'depreciate', asset: a })}
                          >
                            <TrendingDown className="h-3 w-3 mr-1" /> Depreciate
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="p-8 text-center"><Building className="h-10 w-10 mx-auto text-muted-foreground/30 mb-2" /><p className="text-sm text-muted-foreground">No fixed assets yet.</p></div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* Leases */}
      <TabsContent value="leases">
        <Card>
          <CardHeader className="pb-3 flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2"><KeySquare className="h-4 w-4 text-brand-600" /> Leases (IFRS 16)</CardTitle>
            <Dialog open={leaseOpen} onOpenChange={setLeaseOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="bg-brand-600 hover:bg-brand-700"><Plus className="h-4 w-4 mr-1" /> Add Lease</Button>
              </DialogTrigger>
              <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
                <DialogHeader><DialogTitle>Add Lease</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label className="text-xs">Lease Code *</Label><Input className="h-9" value={leaseForm.leaseCode} onChange={(e) => setLeaseForm((f) => ({ ...f, leaseCode: e.target.value }))} /></div>
                    <div><Label className="text-xs">Lessor *</Label><Input className="h-9" value={leaseForm.lessor} onChange={(e) => setLeaseForm((f) => ({ ...f, lessor: e.target.value }))} /></div>
                  </div>
                  <div><Label className="text-xs">Description *</Label><Input className="h-9" value={leaseForm.description} onChange={(e) => setLeaseForm((f) => ({ ...f, description: e.target.value }))} /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label className="text-xs">Start Date *</Label><Input type="date" className="h-9" value={leaseForm.startDate} onChange={(e) => setLeaseForm((f) => ({ ...f, startDate: e.target.value }))} /></div>
                    <div><Label className="text-xs">End Date *</Label><Input type="date" className="h-9" value={leaseForm.endDate} onChange={(e) => setLeaseForm((f) => ({ ...f, endDate: e.target.value }))} /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label className="text-xs">Monthly Payment *</Label><Input type="number" className="h-9" value={leaseForm.monthlyPayment} onChange={(e) => setLeaseForm((f) => ({ ...f, monthlyPayment: e.target.value }))} /></div>
                    <div><Label className="text-xs">Discount Rate (%) *</Label><Input type="number" className="h-9" value={leaseForm.discountRate} onChange={(e) => setLeaseForm((f) => ({ ...f, discountRate: e.target.value }))} /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label className="text-xs">ROU Asset Value *</Label><Input type="number" className="h-9" value={leaseForm.rouAssetValue} onChange={(e) => setLeaseForm((f) => ({ ...f, rouAssetValue: e.target.value }))} /></div>
                    <div><Label className="text-xs">Lease Liability *</Label><Input type="number" className="h-9" value={leaseForm.leaseLiability} onChange={(e) => setLeaseForm((f) => ({ ...f, leaseLiability: e.target.value }))} /></div>
                  </div>
                  <Button
                    className="w-full bg-brand-600 hover:bg-brand-700"
                    disabled={leaseMutation.isPending}
                    onClick={() => {
                      if (!leaseForm.leaseCode || !leaseForm.description || !leaseForm.lessor || !leaseForm.startDate || !leaseForm.endDate || !leaseForm.rouAssetValue || !leaseForm.leaseLiability) { toast.error('Please fill in all required fields'); return; }
                      leaseMutation.mutate({
                        ...leaseForm,
                        branchId: selectedBranchId,
                        monthlyPayment: Number(leaseForm.monthlyPayment),
                        discountRate: Number(leaseForm.discountRate),
                        rouAssetValue: Number(leaseForm.rouAssetValue),
                        leaseLiability: Number(leaseForm.leaseLiability),
                      });
                    }}
                  >
                    {leaseMutation.isPending ? 'Saving...' : 'Save Lease'}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent className="p-0">
            {leasesError ? (
              <ErrorBanner message={leasesErrorObj instanceof Error ? leasesErrorObj.message : 'Unknown error'} />
            ) : leasesLoading ? (
              <div className="p-6 space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : leases.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Description</TableHead><TableHead>Lessor</TableHead><TableHead>Monthly</TableHead><TableHead>ROU Asset</TableHead><TableHead>Liability</TableHead><TableHead>Status</TableHead><TableHead>Action</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {leases.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell className="font-mono text-xs px-1.5 py-0.5 rounded bg-brand-50 text-brand-800 border border-brand-200">{l.leaseCode}</TableCell>
                        <TableCell className="text-sm">{l.description}</TableCell>
                        <TableCell className="text-sm">{l.lessor}</TableCell>
                        <TableCell className="text-sm">{formatMoney(l.monthlyPayment, baseCurrency?.symbol)}</TableCell>
                        <TableCell className="text-sm">{formatMoney(l.rouAssetValue, baseCurrency?.symbol)}</TableCell>
                        <TableCell className="text-sm">{formatMoney(l.leaseLiability, baseCurrency?.symbol)}</TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">{l.status}</Badge></TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            disabled={l.status !== 'ACTIVE'}
                            onClick={() => setPeriodActionTarget({ kind: 'lease-payment', lease: l })}
                          >
                            <Landmark className="h-3 w-3 mr-1" /> Record Payment
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="p-8 text-center"><KeySquare className="h-10 w-10 mx-auto text-muted-foreground/30 mb-2" /><p className="text-sm text-muted-foreground">No leases yet.</p></div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* Revenue Contracts */}
      <TabsContent value="revenue">
        <Card>
          <CardHeader className="pb-3 flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2"><Receipt className="h-4 w-4 text-brand-600" /> Revenue Contracts (IFRS 15)</CardTitle>
            <Dialog open={contractOpen} onOpenChange={setContractOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="bg-brand-600 hover:bg-brand-700"><Plus className="h-4 w-4 mr-1" /> Add Contract</Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader><DialogTitle>Add Revenue Contract</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label className="text-xs">Contract Code *</Label><Input className="h-9" value={contractForm.contractCode} onChange={(e) => setContractForm((f) => ({ ...f, contractCode: e.target.value }))} /></div>
                    <div><Label className="text-xs">Customer *</Label><Input className="h-9" placeholder="NHIS" value={contractForm.customerName} onChange={(e) => setContractForm((f) => ({ ...f, customerName: e.target.value }))} /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label className="text-xs">Total Value *</Label><Input type="number" className="h-9" value={contractForm.totalContractValue} onChange={(e) => setContractForm((f) => ({ ...f, totalContractValue: e.target.value }))} /></div>
                    <div><Label className="text-xs">Start Date *</Label><Input type="date" className="h-9" value={contractForm.startDate} onChange={(e) => setContractForm((f) => ({ ...f, startDate: e.target.value }))} /></div>
                  </div>
                  <div>
                    <Label className="text-xs">Recognition Method</Label>
                    <Select value={contractForm.recognitionMethod} onValueChange={(v) => setContractForm((f) => ({ ...f, recognitionMethod: v }))}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="POINT_IN_TIME">POINT_IN_TIME</SelectItem>
                        <SelectItem value="OVER_TIME">OVER_TIME</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    className="w-full bg-brand-600 hover:bg-brand-700"
                    disabled={contractMutation.isPending}
                    onClick={() => {
                      if (!contractForm.contractCode || !contractForm.customerName || !contractForm.totalContractValue || !contractForm.startDate) { toast.error('Please fill in all required fields'); return; }
                      contractMutation.mutate({ ...contractForm, branchId: selectedBranchId, totalContractValue: Number(contractForm.totalContractValue) });
                    }}
                  >
                    {contractMutation.isPending ? 'Saving...' : 'Save Contract'}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent className="p-0">
            {contractsError ? (
              <ErrorBanner message={contractsErrorObj instanceof Error ? contractsErrorObj.message : 'Unknown error'} />
            ) : contractsLoading ? (
              <div className="p-6 space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : revenueContracts.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Customer</TableHead><TableHead>Total</TableHead><TableHead>Recognized</TableHead><TableHead>Deferred</TableHead><TableHead>Method</TableHead><TableHead>Action</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {revenueContracts.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-mono text-xs px-1.5 py-0.5 rounded bg-brand-50 text-brand-800 border border-brand-200">{c.contractCode}</TableCell>
                        <TableCell className="text-sm">{c.customerName}</TableCell>
                        <TableCell className="text-sm">{formatMoney(c.totalContractValue, baseCurrency?.symbol)}</TableCell>
                        <TableCell className="text-sm text-brand-700">{formatMoney(c.recognizedRevenue, baseCurrency?.symbol)}</TableCell>
                        <TableCell className="text-sm text-amber-700">{formatMoney(c.deferredRevenue, baseCurrency?.symbol)}</TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">{c.recognitionMethod}</Badge></TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            disabled={c.status !== 'ACTIVE' || c.deferredRevenue <= 0}
                            onClick={() => setPeriodActionTarget({ kind: 'recognize', contract: c })}
                          >
                            <BadgeCheck className="h-3 w-3 mr-1" /> Recognize
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="p-8 text-center"><Receipt className="h-10 w-10 mx-auto text-muted-foreground/30 mb-2" /><p className="text-sm text-muted-foreground">No revenue contracts yet.</p></div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* Inventory Valuations */}
      <TabsContent value="valuations">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><PackageMinus className="h-4 w-4 text-brand-600" /> Inventory Valuations (IAS 2 — NRV)</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {valuationsError ? (
              <ErrorBanner message={valuationsErrorObj instanceof Error ? valuationsErrorObj.message : 'Unknown error'} />
            ) : valuationsLoading ? (
              <div className="p-6 space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : valuations.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Product</TableHead><TableHead>Batch</TableHead><TableHead>Cost</TableHead><TableHead>NRV</TableHead><TableHead>Qty</TableHead><TableHead>Write-Down</TableHead><TableHead>Reason</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {valuations.map((v) => (
                      <TableRow key={v.id}>
                        <TableCell className="text-xs">{new Date(v.valuationDate).toLocaleDateString()}</TableCell>
                        <TableCell className="text-sm">{v.batch.product.brandName}</TableCell>
                        <TableCell className="font-mono text-xs px-1.5 py-0.5 rounded bg-brand-50 text-brand-800 border border-brand-200">{v.batch.batchNumber}</TableCell>
                        <TableCell className="text-sm">{formatMoney(v.costPerUnit, baseCurrency?.symbol)}</TableCell>
                        <TableCell className="text-sm">{formatMoney(v.netRealizableValue, baseCurrency?.symbol)}</TableCell>
                        <TableCell className="text-sm">{v.quantityOnHand}</TableCell>
                        <TableCell>
                          {v.writeDownRequired ? (
                            <Badge variant="outline" className="text-rose-600 border-rose-300 text-xs">{formatMoney(v.writeDownAmount, baseCurrency?.symbol)}</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">None</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-40 truncate">{v.reason || '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="p-8 text-center"><PackageMinus className="h-10 w-10 mx-auto text-muted-foreground/30 mb-2" /><p className="text-sm text-muted-foreground">No valuations recorded yet.</p></div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* Accounting Periods + Trial Balance */}
      <TabsContent value="periods" className="space-y-4">
        <Card>
          <CardHeader className="pb-3 flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2"><Scale className="h-4 w-4 text-brand-600" /> Trial Balance</CardTitle>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">As of</Label>
              <Input
                type="date"
                className="h-8 w-40"
                value={trialBalanceDate}
                onChange={(e) => setTrialBalanceDate(e.target.value)}
              />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {trialBalanceError ? (
              <ErrorBanner message={trialBalanceErrorObj instanceof Error ? trialBalanceErrorObj.message : 'Unknown error'} />
            ) : trialBalanceLoading ? (
              <div className="p-6 space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : trialBalance && trialBalance.rows.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Account</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Debit</TableHead>
                      <TableHead className="text-right">Credit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {trialBalance.rows.map((r) => (
                      <TableRow key={r.accountId}>
                        <TableCell className="font-mono text-xs px-1.5 py-0.5 rounded bg-brand-50 text-brand-800 border border-brand-200">{r.accountCode}</TableCell>
                        <TableCell className="text-sm">{r.accountName}</TableCell>
                        <TableCell><Badge variant="secondary" className="text-xs">{r.accountType}</Badge></TableCell>
                        <TableCell className="text-sm text-right">{r.debitBalance > 0 ? formatMoney(r.debitBalance, baseCurrency?.symbol) : ''}</TableCell>
                        <TableCell className="text-sm text-right">{r.creditBalance > 0 ? formatMoney(r.creditBalance, baseCurrency?.symbol) : ''}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="font-medium border-t-2">
                      <TableCell colSpan={3} className="text-sm">Totals</TableCell>
                      <TableCell className="text-sm text-right">{formatMoney(trialBalance.totalDebits, baseCurrency?.symbol)}</TableCell>
                      <TableCell className="text-sm text-right">{formatMoney(trialBalance.totalCredits, baseCurrency?.symbol)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
                <div className="px-4 py-3">
                  {trialBalance.isBalanced ? (
                    <Badge className="bg-emerald-100 text-emerald-700 text-xs"><CheckCircle2 className="h-3 w-3 mr-1" /> Balanced</Badge>
                  ) : (
                    <Badge className="bg-rose-100 text-rose-700 text-xs">Out of balance by {formatMoney(Math.abs(trialBalance.difference), baseCurrency?.symbol)}</Badge>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-8 text-center"><Scale className="h-10 w-10 mx-auto text-muted-foreground/30 mb-2" /><p className="text-sm text-muted-foreground">No ledger activity as of this date.</p></div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><CalendarClock className="h-4 w-4 text-brand-600" /> Accounting Periods</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {periodsError ? (
              <ErrorBanner message={periodsErrorObj instanceof Error ? periodsErrorObj.message : 'Unknown error'} />
            ) : periodsLoading ? (
              <div className="p-6 space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : periods.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Period</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Closed By</TableHead>
                      <TableHead>Closed At</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {periods.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="text-sm font-mono">{p.periodName}</TableCell>
                        <TableCell>
                          {p.status === 'OPEN' ? (
                            <Badge className="bg-emerald-100 text-emerald-700 text-xs"><LockOpen className="h-3 w-3 mr-1" /> Open</Badge>
                          ) : p.status === 'CLOSED' ? (
                            <Badge className="bg-slate-100 text-slate-700 text-xs"><Lock className="h-3 w-3 mr-1" /> Closed</Badge>
                          ) : (
                            <Badge className="bg-rose-100 text-rose-700 text-xs"><Lock className="h-3 w-3 mr-1" /> Locked</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{p.closedByUser?.fullName ?? '-'}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{p.closedAt ? new Date(p.closedAt).toLocaleString() : '-'}</TableCell>
                        <TableCell>
                          {p.status === 'OPEN' && canManagePeriods && (
                            <Button
                              variant="ghost" size="sm" className="h-7 text-xs"
                              disabled={closePeriodMutation.isPending}
                              onClick={() => closePeriodMutation.mutate(p.id)}
                            >
                              Close Period
                            </Button>
                          )}
                          {p.status === 'CLOSED' && canManagePeriods && (
                            <Button
                              variant="ghost" size="sm" className="h-7 text-xs"
                              disabled={reopenPeriodMutation.isPending}
                              onClick={() => reopenPeriodMutation.mutate(p.id)}
                            >
                              Reopen
                            </Button>
                          )}
                          {!canManagePeriods && (
                            <span className="text-xs text-muted-foreground">Admin/Manager only</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="p-8 text-center"><CalendarClock className="h-10 w-10 mx-auto text-muted-foreground/30 mb-2" /><p className="text-sm text-muted-foreground">No periods yet.</p></div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* Shared period-action dialog: depreciation / lease payment / revenue recognition */}
      <Dialog open={!!periodActionTarget} onOpenChange={(open) => { if (!open) closePeriodActionDialog(); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {periodActionTarget?.kind === 'depreciate' && `Depreciate — ${periodActionTarget.asset.assetCode}`}
              {periodActionTarget?.kind === 'lease-payment' && `Record Payment — ${periodActionTarget.lease.leaseCode}`}
              {periodActionTarget?.kind === 'recognize' && `Recognize Revenue — ${periodActionTarget.contract.contractCode}`}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Accounting Period *</Label>
              <Select value={periodActionPeriodId} onValueChange={setPeriodActionPeriodId}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Select period" /></SelectTrigger>
                <SelectContent>
                  {periods.filter((p) => p.status !== 'CLOSED').map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.periodName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {periods.length === 0 && (
                <p className="text-[10px] text-amber-700 mt-1">No accounting periods exist yet — create one in the Periods tab first.</p>
              )}
            </div>
            {periodActionTarget?.kind === 'recognize' && (
              <div>
                <Label className="text-xs">Amount to Recognize *</Label>
                <Input
                  type="number"
                  className="h-9"
                  placeholder={`Up to ${formatMoney(periodActionTarget.contract.deferredRevenue, baseCurrency?.symbol)}`}
                  value={recognizeAmount}
                  onChange={(e) => setRecognizeAmount(e.target.value)}
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  {formatMoney(periodActionTarget.contract.deferredRevenue, baseCurrency?.symbol)} remains deferred on this contract.
                </p>
              </div>
            )}
            <Button
              className="w-full bg-brand-600 hover:bg-brand-700"
              disabled={periodActionPending}
              onClick={handlePeriodActionSubmit}
            >
              {periodActionPending ? 'Posting...' : 'Post to Ledger'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Tabs>
  );
}

// =============================================================================
// PAYMENTS — a guided cash-disbursement form: pick any Expense account (a
// routine cost with no prior liability) or any Liability account
// (including a payable owed to a supplier) from one combined list, rather
// than needing the more technical manual Journal Entry screen for what's
// usually just "pay this bill."
// =============================================================================

interface PaymentEntry {
  id: string;
  entryNumber: string;
  entryDate: string;
  description?: string;
  lines: { debit: number; credit: number; account: { accountCode: string; accountName: string; accountType: string } }[];
  postedByUser: { fullName: string };
}

interface PaymentSupplier {
  id: number;
  name: string;
  apAccountId?: number | null;
}

function PaymentsSection({
  accounts,
  selectedBranchId,
  baseCurrency,
  queryClient,
}: {
  accounts: Account[];
  selectedBranchId: string;
  baseCurrency?: Currency;
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  const [payOpen, setPayOpen] = useState(false);
  // Combined into one field with a prefix (`supplier:5` / `account:12`)
  // rather than two separate selects, so choosing one always clears the
  // other — no risk of submitting a stale account alongside a newly
  // picked supplier.
  const [payTarget, setPayTarget] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payDescription, setPayDescription] = useState('');
  const [payDate, setPayDate] = useState('');

  const { data: payments = [], isLoading, isError, error } = useQuery<PaymentEntry[]>({
    queryKey: ['payments', selectedBranchId],
    queryFn: () => fetchJson<PaymentEntry[]>(`/api/v1/payments?branchId=${selectedBranchId}`),
  });

  // "Droplist of all suppliers" — every supplier, active or not yet
  // linked to their own AP account (paying an unlinked one still works,
  // it resolves to the shared global AP account server-side).
  const { data: suppliers = [] } = useQuery<PaymentSupplier[]>({
    queryKey: ['suppliers-for-payment'],
    queryFn: () => fetchJson<PaymentSupplier[]>('/api/v1/suppliers'),
  });

  const supplierApAccountIds = new Set(suppliers.map((s) => s.apAccountId).filter((id): id is number => id != null));
  const expenseAccounts = accounts.filter((a) => a.isActive && a.accountType === 'EXPENSE');
  // Excludes accounts already reachable via the Suppliers group above, so
  // a linked supplier's AP account doesn't appear twice under two
  // different, easy-to-confuse paths to the exact same posting.
  const otherLiabilityAccounts = accounts.filter(
    (a) => a.isActive && a.accountType === 'LIABILITY' && !supplierApAccountIds.has(a.id)
  );

  const paymentMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetchJson('/api/v1/payments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success('Payment recorded!');
      setPayOpen(false);
      setPayTarget('');
      setPayAmount('');
      setPayDescription('');
      setPayDate('');
      queryClient.invalidateQueries({ queryKey: ['payments'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handlePay = () => {
    if (!payTarget || !payAmount || Number(payAmount) <= 0) {
      toast.error("Select what you're paying and enter a positive amount");
      return;
    }
    const [kind, id] = payTarget.split(':');
    paymentMutation.mutate({
      branchId: selectedBranchId,
      supplierId: kind === 'supplier' ? Number(id) : undefined,
      accountId: kind === 'account' ? Number(id) : undefined,
      amount: Number(payAmount),
      description: payDescription || undefined,
      paymentDate: payDate || undefined,
    });
  };

  return (
    <Card>
      <CardHeader className="pb-3 flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2"><CreditCardIcon className="h-4 w-4 text-brand-600" /> Payments</CardTitle>
        <Dialog open={payOpen} onOpenChange={setPayOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="bg-brand-600 hover:bg-brand-700"><Plus className="h-4 w-4 mr-1" /> Make a Payment</Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Make a Payment</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">What are you paying? *</Label>
                <Select value={payTarget} onValueChange={setPayTarget}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Select a supplier, expense, or payable" /></SelectTrigger>
                  <SelectContent>
                    {suppliers.length > 0 && (
                      <>
                        <div className="px-2 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Suppliers</div>
                        {suppliers.map((s) => (
                          <SelectItem key={`supplier:${s.id}`} value={`supplier:${s.id}`}>
                            {s.name}{!s.apAccountId ? ' (default AP account)' : ''}
                          </SelectItem>
                        ))}
                      </>
                    )}
                    {expenseAccounts.length > 0 && (
                      <>
                        <div className="px-2 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Expenses</div>
                        {expenseAccounts.map((a) => (
                          <SelectItem key={`account:${a.id}`} value={`account:${a.id}`}>{a.accountCode} — {a.accountName}</SelectItem>
                        ))}
                      </>
                    )}
                    {otherLiabilityAccounts.length > 0 && (
                      <>
                        <div className="px-2 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Other Liabilities</div>
                        {otherLiabilityAccounts.map((a) => (
                          <SelectItem key={`account:${a.id}`} value={`account:${a.id}`}>{a.accountCode} — {a.accountName}</SelectItem>
                        ))}
                      </>
                    )}
                  </SelectContent>
                </Select>
                {suppliers.length === 0 && expenseAccounts.length === 0 && otherLiabilityAccounts.length === 0 && (
                  <p className="text-[10px] text-amber-700 mt-1">No suppliers or Expense/Liability accounts exist yet.</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Amount *</Label>
                  <Input type="number" className="h-9" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Date</Label>
                  <Input type="date" className="h-9" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
                </div>
              </div>
              <div>
                <Label className="text-xs">Description</Label>
                <Input className="h-9" placeholder="e.g. March rent, Supplier invoice #1042" value={payDescription} onChange={(e) => setPayDescription(e.target.value)} />
              </div>
              <p className="text-[10px] text-muted-foreground">Posts against CASH (Settings → GL Mappings) — make sure that&apos;s configured first.</p>
              <Button className="w-full bg-brand-600 hover:bg-brand-700" disabled={paymentMutation.isPending} onClick={handlePay}>
                {paymentMutation.isPending ? 'Recording...' : 'Record Payment'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="p-0">
        {isError ? (
          <ErrorBanner message={errorMessage(error)} />
        ) : isLoading ? (
          <div className="p-6 space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : payments.length > 0 ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Entry</TableHead><TableHead>Paid</TableHead><TableHead>Amount</TableHead><TableHead>Description</TableHead><TableHead>Posted By</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
              <TableBody>
                {payments.map((p) => {
                  const paidLine = p.lines.find((l) => l.debit > 0);
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-xs px-1.5 py-0.5 rounded bg-brand-50 text-brand-800 border border-brand-200">{p.entryNumber}</TableCell>
                      <TableCell className="text-sm">
                        {paidLine?.account.accountName}
                        {paidLine && <Badge variant="outline" className="text-[10px] ml-1.5">{paidLine.account.accountType}</Badge>}
                      </TableCell>
                      <TableCell className="text-sm font-medium">{formatMoney(paidLine?.debit ?? 0, baseCurrency?.symbol)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{p.description || '-'}</TableCell>
                      <TableCell className="text-sm">{p.postedByUser.fullName}</TableCell>
                      <TableCell className="text-xs">{new Date(p.entryDate).toLocaleDateString()}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="p-8 text-center"><CreditCardIcon className="h-10 w-10 mx-auto text-muted-foreground/30 mb-2" /><p className="text-sm text-muted-foreground">No payments recorded yet.</p></div>
        )}
      </CardContent>
    </Card>
  );
}
