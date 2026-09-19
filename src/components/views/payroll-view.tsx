'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usePharmacyStore } from '@/lib/store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { TileTabsList, TileTabsTrigger } from '@/components/ui/tile-tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SearchInput } from '@/components/ui/search-input';
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Users2, Wallet, Receipt, Plus, Pencil, Trash2, PlayCircle, AlertTriangle, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { fetchJson } from '@/lib/fetch-json';
import { ErrorBanner, errorMessage } from '@/components/ui/error-banner';
import { formatMoney } from '@/lib/currency';
import { useBaseCurrency } from '@/hooks/use-base-currency';

// =============================================================================
// SHARED TYPES
// =============================================================================

interface Employee {
  id: string;
  employeeCode: string;
  fullName: string;
  ssnitNumber?: string | null;
  tinNumber?: string | null;
  bankName?: string | null;
  bankAccountNo?: string | null;
  basicSalary: number;
  allowances: number;
  employmentDate: string;
  isActive: boolean;
  user?: { id: number; username: string } | null;
}

interface TaxBand {
  id: number;
  minAmount: number;
  maxAmount: number | null;
  ratePct: number;
  sortOrder: number;
}

interface PayrollSettings {
  ssnitEmployeePct: number;
  ssnitEmployerPct: number;
  ssnitCeiling: number | null;
}

interface PayRun {
  id: string;
  runNumber: string;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  status: string;
  totalGross: number;
  totalPaye: number;
  totalSsnitEmployee: number;
  totalSsnitEmployer: number;
  totalNet: number;
  processedByUser: { fullName: string };
}

interface PayslipLine {
  id: string;
  employee: { employeeCode: string; fullName: string };
  basicSalary: number;
  allowances: number;
  grossPay: number;
  ssnitEmployee: number;
  ssnitEmployer: number;
  payeTax: number;
  otherDeductions: number;
  netPay: number;
}

export function PayrollView() {
  return (
    <Tabs defaultValue="employees" className="space-y-4">
      <TileTabsList>
        <TileTabsTrigger value="employees" icon={Users2} label="Employees" color="brand" />
        <TileTabsTrigger value="runs" icon={Receipt} label="Pay Runs" color="teal" />
        <TileTabsTrigger value="settings" icon={Wallet} label="Tax & SSNIT Settings" color="amber" />
      </TileTabsList>

      <TabsContent value="employees">
        <EmployeesSection />
      </TabsContent>

      <TabsContent value="runs">
        <PayRunsSection />
      </TabsContent>

      <TabsContent value="settings">
        <PayrollSettingsSection />
      </TabsContent>
    </Tabs>
  );
}

// =============================================================================
// EMPLOYEES
// =============================================================================

const emptyEmployeeForm = {
  employeeCode: '', fullName: '', ssnitNumber: '', tinNumber: '', bankName: '', bankAccountNo: '',
  basicSalary: '', allowances: '0', employmentDate: '',
};

function EmployeesSection() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [form, setForm] = useState(emptyEmployeeForm);
  const [deleteTarget, setDeleteTarget] = useState<Employee | null>(null);

  const { data: employees = [], isLoading, isError, error } = useQuery<Employee[]>({
    queryKey: ['payroll-employees'],
    queryFn: () => fetchJson<Employee[]>('/api/v1/employees'),
  });

  const filtered = employees.filter((e) => {
    const q = search.toLowerCase();
    if (!q) return true;
    return e.fullName.toLowerCase().includes(q) || e.employeeCode.toLowerCase().includes(q);
  });

  const saveMutation = useMutation({
    mutationFn: ({ body, method, id }: { body: Record<string, unknown>; method: string; id?: string }) =>
      fetchJson(method === 'PATCH' ? `/api/v1/employees/${id}` : '/api/v1/employees', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: (_, vars) => {
      toast.success(vars.method === 'PATCH' ? 'Employee updated!' : 'Employee added!');
      setDialogOpen(false);
      setEditingEmployee(null);
      setForm(emptyEmployeeForm);
      queryClient.invalidateQueries({ queryKey: ['payroll-employees'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => fetchJson(`/api/v1/employees/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Employee deleted');
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ['payroll-employees'] });
    },
    onError: (e: Error) => {
      toast.error(e.message);
      setDeleteTarget(null);
    },
  });

  const openEdit = (emp: Employee) => {
    setEditingEmployee(emp);
    setForm({
      employeeCode: emp.employeeCode,
      fullName: emp.fullName,
      ssnitNumber: emp.ssnitNumber || '',
      tinNumber: emp.tinNumber || '',
      bankName: emp.bankName || '',
      bankAccountNo: emp.bankAccountNo || '',
      basicSalary: String(emp.basicSalary),
      allowances: String(emp.allowances),
      employmentDate: emp.employmentDate.slice(0, 10),
    });
    setDialogOpen(true);
  };

  const handleSave = () => {
    if (!form.employeeCode || !form.fullName || !form.basicSalary || !form.employmentDate) {
      toast.error('Employee code, full name, basic salary, and employment date are required');
      return;
    }
    const body = {
      employeeCode: form.employeeCode,
      fullName: form.fullName,
      ssnitNumber: form.ssnitNumber || undefined,
      tinNumber: form.tinNumber || undefined,
      bankName: form.bankName || undefined,
      bankAccountNo: form.bankAccountNo || undefined,
      basicSalary: Number(form.basicSalary),
      allowances: Number(form.allowances) || 0,
      employmentDate: form.employmentDate,
    };
    if (editingEmployee) {
      saveMutation.mutate({ body, method: 'PATCH', id: editingEmployee.id });
    } else {
      saveMutation.mutate({ body, method: 'POST' });
    }
  };

  const baseCurrency = useBaseCurrency();

  return (
    <Card>
      <CardHeader className="pb-3 flex-row items-center justify-between flex-wrap gap-3">
        <CardTitle className="text-base flex items-center gap-2"><Users2 className="h-4 w-4 text-brand-600" /> Employees</CardTitle>
        <Dialog
          open={dialogOpen}
          onOpenChange={(open) => { setDialogOpen(open); if (!open) { setEditingEmployee(null); setForm(emptyEmployeeForm); } }}
        >
          <DialogTrigger asChild>
            <Button size="sm" className="bg-brand-600 hover:bg-brand-700"><Plus className="h-4 w-4 mr-1" /> Add Employee</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{editingEmployee ? 'Edit' : 'Add'} Employee</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Employee Code *</Label>
                  <Input className="h-9" value={form.employeeCode} onChange={(e) => setForm((f) => ({ ...f, employeeCode: e.target.value }))} disabled={!!editingEmployee} />
                </div>
                <div>
                  <Label className="text-xs">Full Name *</Label>
                  <Input className="h-9" value={form.fullName} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Basic Salary (monthly) *</Label>
                  <Input type="number" className="h-9" value={form.basicSalary} onChange={(e) => setForm((f) => ({ ...f, basicSalary: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">Allowances (monthly)</Label>
                  <Input type="number" className="h-9" value={form.allowances} onChange={(e) => setForm((f) => ({ ...f, allowances: e.target.value }))} />
                </div>
              </div>
              <div>
                <Label className="text-xs">Employment Date *</Label>
                <Input type="date" className="h-9" value={form.employmentDate} onChange={(e) => setForm((f) => ({ ...f, employmentDate: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">SSNIT Number</Label>
                  <Input className="h-9" value={form.ssnitNumber} onChange={(e) => setForm((f) => ({ ...f, ssnitNumber: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">TIN</Label>
                  <Input className="h-9" value={form.tinNumber} onChange={(e) => setForm((f) => ({ ...f, tinNumber: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Bank Name</Label>
                  <Input className="h-9" value={form.bankName} onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">Bank Account No.</Label>
                  <Input className="h-9" value={form.bankAccountNo} onChange={(e) => setForm((f) => ({ ...f, bankAccountNo: e.target.value }))} />
                </div>
              </div>
              <Button className="w-full bg-brand-600 hover:bg-brand-700" disabled={saveMutation.isPending} loading={saveMutation.isPending} onClick={handleSave}>
                {saveMutation.isPending ? 'Saving...' : 'Save Employee'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="p-0">
        <div className="p-4 border-b">
          <SearchInput className="max-w-sm" placeholder="Search by name or employee code..." value={search} onChange={setSearch} />
        </div>
        {isError ? (
          <ErrorBanner message={errorMessage(error)} />
        ) : isLoading ? (
          <div className="p-6 space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : filtered.length > 0 ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Basic Salary</TableHead>
                  <TableHead>Allowances</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((emp) => (
                  <TableRow key={emp.id}>
                    <TableCell className="font-mono text-xs px-1.5 py-0.5 rounded bg-brand-50 text-brand-800 border border-brand-200">{emp.employeeCode}</TableCell>
                    <TableCell className="text-sm font-medium">{emp.fullName}</TableCell>
                    <TableCell className="text-sm">{formatMoney(emp.basicSalary, baseCurrency)}</TableCell>
                    <TableCell className="text-sm">{formatMoney(emp.allowances, baseCurrency)}</TableCell>
                    <TableCell>
                      <Badge variant={emp.isActive ? 'default' : 'secondary'} className={cn('text-xs', emp.isActive && 'bg-brand-100 text-brand-700')}>
                        {emp.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => openEdit(emp)}>
                          <Pencil className="h-3 w-3 mr-1" /> Edit
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 text-xs text-rose-600" onClick={() => setDeleteTarget(emp)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="p-8 text-center">
            <Users2 className="h-10 w-10 mx-auto text-muted-foreground/30 mb-2" />
            <p className="text-sm text-muted-foreground">{search ? `No employees match "${search}".` : 'No employees yet.'}</p>
          </div>
        )}
      </CardContent>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.fullName}?</AlertDialogTitle>
            <AlertDialogDescription>
              This only works if they&apos;ve never appeared on a processed pay run. If they have, deactivate them
              instead by editing their record — that stops future pay runs without destroying their payslip history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 hover:bg-rose-700 focus:ring-rose-600"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// =============================================================================
// TAX BANDS & SSNIT SETTINGS
// =============================================================================

function PayrollSettingsSection() {
  const queryClient = useQueryClient();
  const baseCurrency = useBaseCurrency();
  const [bandForm, setBandForm] = useState({ minAmount: '', maxAmount: '', ratePct: '' });
  const [deleteBandTarget, setDeleteBandTarget] = useState<TaxBand | null>(null);

  const { data: bands = [], isLoading: bandsLoading, isError: bandsError, error: bandsErrorObj } = useQuery<TaxBand[]>({
    queryKey: ['payroll-tax-bands'],
    queryFn: () => fetchJson<TaxBand[]>('/api/v1/payroll/tax-bands'),
  });

  const { data: settings, isLoading: settingsLoading } = useQuery<PayrollSettings>({
    queryKey: ['payroll-settings'],
    queryFn: () => fetchJson<PayrollSettings>('/api/v1/payroll/settings'),
  });

  const [ssnitForm, setSsnitForm] = useState({ ssnitEmployeePct: '', ssnitEmployerPct: '', ssnitCeiling: '' });
  const [ssnitFormInitialized, setSsnitFormInitialized] = useState(false);
  if (settings && !ssnitFormInitialized) {
    setSsnitForm({
      ssnitEmployeePct: String(settings.ssnitEmployeePct),
      ssnitEmployerPct: String(settings.ssnitEmployerPct),
      ssnitCeiling: settings.ssnitCeiling != null ? String(settings.ssnitCeiling) : '',
    });
    setSsnitFormInitialized(true);
  }

  const addBandMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetchJson('/api/v1/payroll/tax-bands', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success('Tax band added');
      setBandForm({ minAmount: '', maxAmount: '', ratePct: '' });
      queryClient.invalidateQueries({ queryKey: ['payroll-tax-bands'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteBandMutation = useMutation({
    mutationFn: (id: number) => fetchJson(`/api/v1/payroll/tax-bands/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Tax band removed');
      setDeleteBandTarget(null);
      queryClient.invalidateQueries({ queryKey: ['payroll-tax-bands'] });
    },
    onError: (e: Error) => {
      toast.error(e.message);
      setDeleteBandTarget(null);
    },
  });

  const saveSsnitMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetchJson('/api/v1/payroll/settings', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success('SSNIT settings saved');
      queryClient.invalidateQueries({ queryKey: ['payroll-settings'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleAddBand = () => {
    if (!bandForm.minAmount || !bandForm.ratePct) {
      toast.error('Minimum amount and rate are required');
      return;
    }
    addBandMutation.mutate({
      minAmount: Number(bandForm.minAmount),
      maxAmount: bandForm.maxAmount ? Number(bandForm.maxAmount) : null,
      ratePct: Number(bandForm.ratePct),
      sortOrder: bands.length,
    });
  };

  const handleSaveSsnit = () => {
    saveSsnitMutation.mutate({
      ssnitEmployeePct: Number(ssnitForm.ssnitEmployeePct),
      ssnitEmployerPct: Number(ssnitForm.ssnitEmployerPct),
      ssnitCeiling: ssnitForm.ssnitCeiling ? Number(ssnitForm.ssnitCeiling) : null,
    });
  };

  const sortedBands = [...bands].sort((a, b) => a.minAmount - b.minAmount);

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p>
            <strong>Verify before relying on these for real payroll.</strong> Ghana&apos;s PAYE bands change periodically
            via the national Budget. The values below are seeded from GRA&apos;s own published table (effective
            January 1, 2024) as a starting point, not a guarantee they&apos;re still current — check the official
            page below and adjust as needed.
          </p>
          <a
            href="https://gra.gov.gh/domestic-tax/tax-types/paye/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-medium text-amber-900 underline hover:text-amber-950"
          >
            <ExternalLink className="h-3 w-3" /> Check current bands on gra.gov.gh
          </a>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Wallet className="h-4 w-4 text-brand-600" /> PAYE Tax Bands (monthly)</CardTitle>
        </CardHeader>
        <CardContent>
          {bandsError ? (
            <ErrorBanner message={errorMessage(bandsErrorObj)} />
          ) : bandsLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow><TableHead>From</TableHead><TableHead>To</TableHead><TableHead>Rate</TableHead><TableHead></TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {sortedBands.map((band) => (
                    <TableRow key={band.id}>
                      <TableCell className="text-sm">{formatMoney(band.minAmount, baseCurrency)}</TableCell>
                      <TableCell className="text-sm">{band.maxAmount !== null ? formatMoney(band.maxAmount, baseCurrency) : 'and above'}</TableCell>
                      <TableCell className="text-sm">{band.ratePct}%</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-rose-600"
                          disabled={deleteBandMutation.isPending}
                          onClick={() => setDeleteBandTarget(band)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {bands.length === 0 && (
                <p className="text-sm text-muted-foreground py-4 text-center">No tax bands configured yet — add at least one below before running payroll.</p>
              )}
              <div className="flex items-end gap-2 flex-wrap mt-4 pt-4 border-t">
                <div>
                  <Label className="text-xs">From</Label>
                  <Input type="number" className="h-9 w-28" value={bandForm.minAmount} onChange={(e) => setBandForm((f) => ({ ...f, minAmount: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">To (blank = no limit)</Label>
                  <Input type="number" className="h-9 w-28" value={bandForm.maxAmount} onChange={(e) => setBandForm((f) => ({ ...f, maxAmount: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">Rate %</Label>
                  <Input type="number" className="h-9 w-24" value={bandForm.ratePct} onChange={(e) => setBandForm((f) => ({ ...f, ratePct: e.target.value }))} />
                </div>
                <Button size="sm" className="bg-brand-600 hover:bg-brand-700" disabled={addBandMutation.isPending} loading={addBandMutation.isPending} onClick={handleAddBand}>
                  <Plus className="h-4 w-4 mr-1" /> Add Band
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Wallet className="h-4 w-4 text-brand-600" /> SSNIT Contribution Rates</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {settingsLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs">Employee %</Label>
                  <Input type="number" className="h-9" value={ssnitForm.ssnitEmployeePct} onChange={(e) => setSsnitForm((f) => ({ ...f, ssnitEmployeePct: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">Employer %</Label>
                  <Input type="number" className="h-9" value={ssnitForm.ssnitEmployerPct} onChange={(e) => setSsnitForm((f) => ({ ...f, ssnitEmployerPct: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">Ceiling (blank = uncapped)</Label>
                  <Input type="number" className="h-9" value={ssnitForm.ssnitCeiling} onChange={(e) => setSsnitForm((f) => ({ ...f, ssnitCeiling: e.target.value }))} />
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground">SSNIT is calculated on basic salary only, not allowances.</p>
              <Button className="bg-brand-600 hover:bg-brand-700" disabled={saveSsnitMutation.isPending} loading={saveSsnitMutation.isPending} onClick={handleSaveSsnit}>
                {saveSsnitMutation.isPending ? 'Saving...' : 'Save SSNIT Settings'}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!deleteBandTarget} onOpenChange={(open) => { if (!open) setDeleteBandTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this tax band?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteBandTarget && (
                <>
                  {formatMoney(deleteBandTarget.minAmount, baseCurrency)} to{' '}
                  {deleteBandTarget.maxAmount !== null ? formatMoney(deleteBandTarget.maxAmount, baseCurrency) : 'and above'} at{' '}
                  {deleteBandTarget.ratePct}% will no longer be part of the PAYE calculation for any future pay run —
                  make sure the remaining bands still cover the full range with no gaps before running payroll again.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 hover:bg-rose-700 focus:ring-rose-600"
              disabled={deleteBandMutation.isPending}
              onClick={() => deleteBandTarget && deleteBandMutation.mutate(deleteBandTarget.id)}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// =============================================================================
// PAY RUNS
// =============================================================================

function PayRunsSection() {
  const queryClient = useQueryClient();
  const baseCurrency = useBaseCurrency();
  const { selectedBranchId } = usePharmacyStore();
  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [runForm, setRunForm] = useState({ periodStart: '', periodEnd: '', payDate: '' });
  const [adjustments, setAdjustments] = useState<Record<string, string>>({});
  const [viewingRun, setViewingRun] = useState<PayRun | null>(null);

  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ['payroll-employees'],
    queryFn: () => fetchJson<Employee[]>('/api/v1/employees'),
  });
  const activeEmployees = employees.filter((e) => e.isActive);

  const { data: runs = [], isLoading, isError, error } = useQuery<PayRun[]>({
    queryKey: ['pay-runs'],
    queryFn: () => fetchJson<PayRun[]>('/api/v1/payroll/runs'),
  });

  const { data: runDetail, isLoading: detailLoading } = useQuery<PayRun & { lines: PayslipLine[] }>({
    queryKey: ['pay-run-detail', viewingRun?.id],
    queryFn: () => fetchJson(`/api/v1/payroll/runs/${viewingRun?.id}`),
    enabled: !!viewingRun,
  });

  const runMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetchJson('/api/v1/payroll/runs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success('Payroll processed and posted to the ledger!');
      setRunDialogOpen(false);
      setRunForm({ periodStart: '', periodEnd: '', payDate: '' });
      setAdjustments({});
      queryClient.invalidateQueries({ queryKey: ['pay-runs'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleRunPayroll = () => {
    if (!runForm.periodStart || !runForm.periodEnd || !runForm.payDate) {
      toast.error('Period start, period end, and pay date are all required');
      return;
    }
    const employeeAdjustments = Object.entries(adjustments)
      .map(([employeeId, value]) => ({ employeeId, otherDeductions: Number(value) }))
      .filter((a) => a.otherDeductions > 0);
    runMutation.mutate({ ...runForm, branchId: selectedBranchId, employeeAdjustments });
  };

  return (
    <Card>
      <CardHeader className="pb-3 flex-row items-center justify-between flex-wrap gap-3">
        <CardTitle className="text-base flex items-center gap-2"><Receipt className="h-4 w-4 text-brand-600" /> Pay Runs</CardTitle>
        <Dialog open={runDialogOpen} onOpenChange={setRunDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="bg-brand-600 hover:bg-brand-700"><PlayCircle className="h-4 w-4 mr-1" /> Run Payroll</Button>
          </DialogTrigger>
          <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Run Payroll</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Computes PAYE and SSNIT for every active employee and posts one entry to the ledger. This can&apos;t be undone from here.
              </p>
              <div>
                <Label className="text-xs">Period Start *</Label>
                <Input type="date" className="h-9" value={runForm.periodStart} onChange={(e) => setRunForm((f) => ({ ...f, periodStart: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Period End *</Label>
                <Input type="date" className="h-9" value={runForm.periodEnd} onChange={(e) => setRunForm((f) => ({ ...f, periodEnd: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Pay Date *</Label>
                <Input type="date" className="h-9" value={runForm.payDate} onChange={(e) => setRunForm((f) => ({ ...f, payDate: e.target.value }))} />
              </div>

              {activeEmployees.length > 0 && (
                <div className="pt-2 border-t">
                  <Label className="text-xs text-muted-foreground">Extra deductions for this run (optional)</Label>
                  <p className="text-[10px] text-muted-foreground mb-2">
                    Leave blank for anyone without one — e.g. a loan repayment or a till shortage, on top of their normal PAYE and SSNIT.
                  </p>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                    {activeEmployees.map((emp) => (
                      <div key={emp.id} className="flex items-center justify-between gap-2">
                        <span className="text-xs truncate">{emp.fullName}</span>
                        <Input
                          type="number"
                          min={0}
                          placeholder="0"
                          className="h-8 w-24 text-xs shrink-0"
                          value={adjustments[emp.id] ?? ''}
                          onChange={(e) => setAdjustments((a) => ({ ...a, [emp.id]: e.target.value }))}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <Button className="w-full bg-brand-600 hover:bg-brand-700" disabled={runMutation.isPending} loading={runMutation.isPending} onClick={handleRunPayroll}>
                {runMutation.isPending ? 'Processing...' : 'Process & Post to Ledger'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="p-0">
        {isError ? (
          <ErrorBanner message={errorMessage(error)} />
        ) : isLoading ? (
          <div className="p-6 space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : runs.length > 0 ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Run #</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Pay Date</TableHead>
                  <TableHead>Gross</TableHead>
                  <TableHead>Net</TableHead>
                  <TableHead>Processed By</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell className="font-mono text-xs px-1.5 py-0.5 rounded bg-brand-50 text-brand-800 border border-brand-200">{run.runNumber}</TableCell>
                    <TableCell className="text-xs">{new Date(run.periodStart).toLocaleDateString()} – {new Date(run.periodEnd).toLocaleDateString()}</TableCell>
                    <TableCell className="text-xs">{new Date(run.payDate).toLocaleDateString()}</TableCell>
                    <TableCell className="text-sm">{formatMoney(run.totalGross, baseCurrency)}</TableCell>
                    <TableCell className="text-sm font-medium">{formatMoney(run.totalNet, baseCurrency)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{run.processedByUser.fullName}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setViewingRun(run)}>View</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="p-8 text-center">
            <Receipt className="h-10 w-10 mx-auto text-muted-foreground/30 mb-2" />
            <p className="text-sm text-muted-foreground">No payroll has been run yet.</p>
          </div>
        )}
      </CardContent>

      <Dialog open={!!viewingRun} onOpenChange={(open) => { if (!open) setViewingRun(null); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{viewingRun?.runNumber} — Payslips</DialogTitle></DialogHeader>
          {detailLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : runDetail ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Gross</TableHead>
                    <TableHead>SSNIT (Emp.)</TableHead>
                    <TableHead>PAYE</TableHead>
                    <TableHead>Other</TableHead>
                    <TableHead>Net Pay</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runDetail.lines.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell className="text-sm">
                        <div className="font-medium">{line.employee.fullName}</div>
                        <div className="text-[10px] text-muted-foreground font-mono">{line.employee.employeeCode}</div>
                      </TableCell>
                      <TableCell className="text-sm">{formatMoney(line.grossPay, baseCurrency)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">({formatMoney(line.ssnitEmployee, baseCurrency)})</TableCell>
                      <TableCell className="text-sm text-muted-foreground">({formatMoney(line.payeTax, baseCurrency)})</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{line.otherDeductions > 0 ? `(${formatMoney(line.otherDeductions, baseCurrency)})` : '-'}</TableCell>
                      <TableCell className="text-sm font-semibold">{formatMoney(line.netPay, baseCurrency)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
