'use client';

import { useState, useEffect, useRef } from 'react';
import { useCompany } from '@/hooks/use-company';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { TileTabsList, TileTabsTrigger } from '@/components/ui/tile-tabs';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
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
import { Switch } from '@/components/ui/switch';
import { UserCog, Link2, ShieldCheck, Plus, KeyRound, AlertTriangle, GitBranch, DatabaseBackup, Download, Upload, AlertOctagon, Building2, Pencil, LayoutGrid, Image } from 'lucide-react';
import { toast } from 'sonner';
import { usePharmacyStore, authFetch } from '@/lib/store';
import { fetchJson } from '@/lib/fetch-json';
import { ErrorBanner, errorMessage } from '@/components/ui/error-banner';
import { ACCESS_LEVELS, type ModuleAccessLevel } from '@/lib/portals';

// =============================================================================
// TYPES
// =============================================================================

interface Profile {
  id: number;
  username: string;
  fullName: string;
  email?: string;
  phone?: string;
  homeBranchId: string;
  licenseNumber?: string;
}

interface Account {
  id: number;
  accountCode: string;
  accountName: string;
}

interface GLMapping {
  id: number;
  mappingKey: string;
  account: { accountCode: string; accountName: string; accountType: string };
}

interface Permission {
  id: number;
  permissionName: string;
  description?: string;
}

interface Role {
  id: number;
  roleName: string;
  description?: string;
  permissions: Permission[];
}

const KNOWN_MAPPING_KEYS = ['CASH', 'AR', 'AP', 'INVENTORY_ASSET', 'COGS', 'SALES_REVENUE', 'SALES_RETURNS', 'TAX_PAYABLE', 'INVENTORY_WRITE_DOWN', 'INTEREST_EXPENSE', 'AMORTIZATION_EXPENSE', 'SALARY_EXPENSE', 'PAYE_PAYABLE', 'SSNIT_PAYABLE', 'SSNIT_EMPLOYER_EXPENSE', 'OTHER_DEDUCTIONS_PAYABLE'];

// =============================================================================
// COMPONENT
// =============================================================================

export function SettingsView() {
  const queryClient = useQueryClient();
  const { user } = usePharmacyStore();
  const canManageAccessControl = user?.roleName === 'ADMIN' || user?.roleName === 'MANAGER';
  const canManageCompany = user?.roleName === 'ADMIN';

  return (
    <Tabs defaultValue="profile" className="space-y-4">
      <TileTabsList>
        <TileTabsTrigger value="profile" icon={UserCog} label="My Profile" color="brand" />
        {canManageCompany && (
          <TileTabsTrigger value="company" icon={Image} label="Company" color="rose" />
        )}
        <TileTabsTrigger value="mappings" icon={Link2} label="GL Mappings" color="sky" />
        <TileTabsTrigger value="approvals" icon={GitBranch} label="Approval Workflow" color="orange" />
        {canManageAccessControl && (
          <TileTabsTrigger value="roles" icon={ShieldCheck} label="Access Control" color="violet" />
        )}
        <TileTabsTrigger value="backup" icon={DatabaseBackup} label="Backup & Restore" color="teal" />
        <TileTabsTrigger value="branches" icon={Building2} label="Branches" color="amber" />
      </TileTabsList>

      <TabsContent value="profile">
        <ProfileSection userId={user?.id} />
      </TabsContent>

      <TabsContent value="company">
        {canManageCompany ? (
          <CompanySection />
        ) : (
          <ErrorBanner message="Only Admin can manage company branding." />
        )}
      </TabsContent>

      <TabsContent value="backup">
        <BackupSection />
      </TabsContent>

      <TabsContent value="branches">
        <BranchesSection queryClient={queryClient} />
      </TabsContent>

      <TabsContent value="approvals">
        <ApprovalsSection queryClient={queryClient} />
      </TabsContent>

      <TabsContent value="mappings">
        <MappingsSection queryClient={queryClient} />
      </TabsContent>

      <TabsContent value="roles">
        {canManageAccessControl ? (
          <AccessControlSection queryClient={queryClient} />
        ) : (
          <ErrorBanner message="Only Admin or Manager can view Access Control." />
        )}
      </TabsContent>
    </Tabs>
  );
}

// =============================================================================
// MY PROFILE
// =============================================================================

// =============================================================================
// BACKUP & RESTORE
// =============================================================================

function BackupSection() {
  const [isDownloading, setIsDownloading] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      const res = await authFetch('/api/v1/settings/backup');
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error((body && body.error) || 'Backup failed');
      }
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="(.+)"/);
      const filename = match ? match[1] : `pharmacycare-backup-${Date.now()}.db`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('Backup downloaded!');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Backup failed');
    } finally {
      setIsDownloading(false);
    }
  };

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setPendingFile(file);
    e.target.value = ''; // allow re-selecting the same file if the dialog is cancelled
  };

  const handleConfirmRestore = async () => {
    if (!pendingFile) return;
    setIsRestoring(true);
    try {
      // Deliberately not using authFetch/fetchJson here — a FormData body
      // must let the browser set its own multipart Content-Type (with the
      // boundary parameter), and authFetch auto-sets application/json
      // whenever a body is present, which would break this upload.
      const token = usePharmacyStore.getState().token;
      const formData = new FormData();
      formData.append('backupFile', pendingFile);
      const res = await fetch('/api/v1/settings/restore', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error((body && body.error) || 'Restore failed');
      toast.success(body?.message || 'Database restored!');
      setPendingFile(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Restore failed');
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Download className="h-4 w-4 text-teal-600" /> Backup</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Download a complete copy of the live database as a single file — every sale, batch, user, and ledger entry, exactly as it exists right now.
          </p>
          <Button className="w-full bg-teal-600 hover:bg-teal-700" disabled={isDownloading} onClick={handleDownload}>
            {isDownloading ? 'Preparing...' : 'Download Backup'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Upload className="h-4 w-4 text-rose-600" /> Restore</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
            <AlertOctagon className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <div>
              Restoring <strong>replaces all current data</strong> with the uploaded backup. A safety copy of
              what&apos;s live right now is kept automatically on the server, but this action can&apos;t be undone
              from within the app itself.
            </div>
          </div>
          <input ref={fileInputRef} type="file" accept=".db" className="hidden" onChange={handleFileSelected} />
          <Button
            variant="outline"
            className="w-full border-rose-300 text-rose-700 hover:bg-rose-50"
            onClick={() => fileInputRef.current?.click()}
          >
            Choose Backup File...
          </Button>
        </CardContent>
      </Card>

      <Dialog open={!!pendingFile} onOpenChange={(open) => { if (!open && !isRestoring) setPendingFile(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Confirm Restore</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm">
              You&apos;re about to replace <strong>all current data</strong> with{' '}
              <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-brand-50 text-brand-800 border border-brand-200">{pendingFile?.name}</span>.
              This cannot be undone from within the app.
            </p>
            <Button variant="destructive" className="w-full" disabled={isRestoring} onClick={handleConfirmRestore}>
              {isRestoring ? 'Restoring...' : 'Yes, Replace All Data'}
            </Button>
            <Button variant="ghost" className="w-full" disabled={isRestoring} onClick={() => setPendingFile(null)}>
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProfileSection({ userId }: { userId?: number }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ fullName: '', email: '', phone: '' });
  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });

  const { data: profile, isLoading, isError, error } = useQuery<Profile>({
    queryKey: ['profile-detail', userId],
    queryFn: () => fetchJson<Profile>(`/api/v1/auth/users/${userId}`),
    enabled: !!userId,
  });

  useEffect(() => {
    if (profile) {
      setForm({ fullName: profile.fullName ?? '', email: profile.email ?? '', phone: profile.phone ?? '' });
    }
  }, [profile]);

  const profileMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetchJson('/api/v1/auth/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success('Profile updated!');
      queryClient.invalidateQueries({ queryKey: ['profile-detail'] });
      queryClient.invalidateQueries({ queryKey: ['users-list'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const passwordMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetchJson('/api/v1/auth/me/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success('Password changed!');
      setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handlePasswordSubmit = () => {
    if (!pwForm.currentPassword || !pwForm.newPassword) { toast.error('Fill in both password fields'); return; }
    if (pwForm.newPassword !== pwForm.confirmPassword) { toast.error("New passwords don't match"); return; }
    if (pwForm.newPassword.length < 8) { toast.error('New password must be at least 8 characters'); return; }
    passwordMutation.mutate({ currentPassword: pwForm.currentPassword, newPassword: pwForm.newPassword });
  };

  if (isError) {
    return (
      <Card><CardContent className="p-0"><ErrorBanner message={errorMessage(error)} /></CardContent></Card>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><UserCog className="h-4 w-4 text-brand-600" /> Profile Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
          ) : (
            <>
              <div>
                <Label className="text-xs">Username</Label>
                <Input className="h-9" value={profile?.username ?? ''} disabled />
                <p className="text-[10px] text-muted-foreground mt-1">Username can&apos;t be changed here — contact an admin.</p>
              </div>
              <div>
                <Label className="text-xs">Full Name</Label>
                <Input className="h-9" value={form.fullName} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Email</Label>
                <Input type="email" className="h-9" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Phone</Label>
                <Input className="h-9" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
              </div>
              <Button
                className="w-full bg-brand-600 hover:bg-brand-700"
                disabled={profileMutation.isPending}
                onClick={() => profileMutation.mutate(form)}
              >
                {profileMutation.isPending ? 'Saving...' : 'Save Profile'}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><KeyRound className="h-4 w-4 text-brand-600" /> Change Password</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label className="text-xs">Current Password</Label>
            <PasswordInput className="h-9" value={pwForm.currentPassword} onChange={(v) => setPwForm((f) => ({ ...f, currentPassword: v }))} autoComplete="current-password" />
          </div>
          <div>
            <Label className="text-xs">New Password</Label>
            <PasswordInput className="h-9" value={pwForm.newPassword} onChange={(v) => setPwForm((f) => ({ ...f, newPassword: v }))} autoComplete="new-password" />
          </div>
          <div>
            <Label className="text-xs">Confirm New Password</Label>
            <PasswordInput className="h-9" value={pwForm.confirmPassword} onChange={(v) => setPwForm((f) => ({ ...f, confirmPassword: v }))} autoComplete="new-password" />
          </div>
          <Button
            className="w-full bg-brand-600 hover:bg-brand-700"
            disabled={passwordMutation.isPending}
            onClick={handlePasswordSubmit}
          >
            {passwordMutation.isPending ? 'Updating...' : 'Change Password'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// =============================================================================
// GL ACCOUNT MAPPINGS
// =============================================================================

function MappingsSection({ queryClient }: { queryClient: ReturnType<typeof useQueryClient> }) {
  const [open, setOpen] = useState(false);
  const [mappingKey, setMappingKey] = useState('');
  const [customKey, setCustomKey] = useState('');
  const [accountId, setAccountId] = useState('');

  const { data: mappings = [], isLoading, isError, error } = useQuery<GLMapping[]>({
    queryKey: ['gl-mappings'],
    queryFn: () => fetchJson<GLMapping[]>('/api/v1/gl-mappings'),
  });

  const { data: accounts = [] } = useQuery<Account[]>({
    queryKey: ['accounts-for-mapping'],
    queryFn: () => fetchJson<Account[]>('/api/v1/accounts'),
  });

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetchJson('/api/v1/gl-mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success('Mapping saved!');
      setOpen(false);
      setMappingKey('');
      setCustomKey('');
      setAccountId('');
      queryClient.invalidateQueries({ queryKey: ['gl-mappings'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const configuredKeys = new Set(mappings.map((m) => m.mappingKey));
  const unconfigured = KNOWN_MAPPING_KEYS.filter((k) => !configuredKeys.has(k));

  const handleSave = () => {
    const key = mappingKey === '__custom__' ? customKey.trim().toUpperCase() : mappingKey;
    if (!key) { toast.error('Choose or enter a mapping key'); return; }
    if (!accountId) { toast.error('Select an account'); return; }
    mutation.mutate({ mappingKey: key, accountId: Number(accountId) });
  };

  return (
    <Card>
      <CardHeader className="pb-3 flex-row items-center justify-between flex-wrap gap-3">
        <CardTitle className="text-base flex items-center gap-2"><Link2 className="h-4 w-4 text-sky-600" /> GL Account Mappings</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="bg-sky-600 hover:bg-sky-700"><Plus className="h-4 w-4 mr-1" /> Set Mapping</Button>
          </DialogTrigger>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Set GL Account Mapping</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Mapping Key *</Label>
                <Select value={mappingKey} onValueChange={setMappingKey}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Select a key" /></SelectTrigger>
                  <SelectContent>
                    {KNOWN_MAPPING_KEYS.map((k) => <SelectItem key={k} value={k}>{k}{configuredKeys.has(k) ? ' (reconfigure)' : ''}</SelectItem>)}
                    <SelectItem value="__custom__">Custom key…</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {mappingKey === '__custom__' && (
                <div>
                  <Label className="text-xs">Custom Key</Label>
                  <Input className="h-9" placeholder="e.g. DISCOUNT_EXPENSE" value={customKey} onChange={(e) => setCustomKey(e.target.value.toUpperCase())} />
                </div>
              )}
              <div>
                <Label className="text-xs">Account *</Label>
                <Select value={accountId} onValueChange={setAccountId}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Select account" /></SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.accountCode} — {a.accountName}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button className="w-full bg-sky-600 hover:bg-sky-700" disabled={mutation.isPending} onClick={handleSave}>
                {mutation.isPending ? 'Saving...' : 'Save Mapping'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="p-0">
        {isError ? (
          <ErrorBanner message={errorMessage(error)} />
        ) : isLoading ? (
          <div className="p-6 space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : (
          <>
            {unconfigured.length > 0 && (
              <div className="m-4 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
                <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <div>
                  <strong>{unconfigured.length} key{unconfigured.length > 1 ? 's' : ''} not configured:</strong> {unconfigured.join(', ')}.
                  Automated postings that need these (sales, goods receipts) will skip GL posting until they&apos;re set.
                </div>
              </div>
            )}
            {mappings.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>Mapping Key</TableHead><TableHead>Account</TableHead><TableHead>Type</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {mappings.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell className="font-mono text-xs px-1.5 py-0.5 rounded bg-brand-50 text-brand-800 border border-brand-200 inline-block">{m.mappingKey}</TableCell>
                        <TableCell className="text-sm">{m.account.accountCode} — {m.account.accountName}</TableCell>
                        <TableCell><Badge variant="secondary" className="text-xs">{m.account.accountType}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="p-8 text-center"><Link2 className="h-10 w-10 mx-auto text-muted-foreground/30 mb-2" /><p className="text-sm text-muted-foreground">No mappings configured yet.</p></div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// =============================================================================
// APPROVAL WORKFLOW
// =============================================================================

interface ApprovalRule {
  id: string;
  entityType: string;
  minAmount: number;
  maxAmount: number | null;
  requiredRole: string;
  description?: string;
  isActive: boolean;
}

const ENTITY_TYPES = [
  { value: 'PURCHASE_ORDER', label: 'Purchase Orders' },
  { value: 'TRANSFER', label: 'Inter-Branch Transfers' },
];
const ROLE_OPTIONS = ['ADMIN', 'MANAGER', 'EMPLOYEE'];

function ApprovalsSection({ queryClient }: { queryClient: ReturnType<typeof useQueryClient> }) {
  const [open, setOpen] = useState(false);
  const [entityType, setEntityType] = useState('PURCHASE_ORDER');
  const [minAmount, setMinAmount] = useState('0');
  const [maxAmount, setMaxAmount] = useState('');
  const [requiredRole, setRequiredRole] = useState('MANAGER');
  const [description, setDescription] = useState('');

  const { data: rules = [], isLoading, isError, error } = useQuery<ApprovalRule[]>({
    queryKey: ['approval-rules'],
    queryFn: () => fetchJson<ApprovalRule[]>('/api/v1/approval-rules'),
  });

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetchJson('/api/v1/approval-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success('Approval rule added!');
      setOpen(false);
      setMinAmount('0');
      setMaxAmount('');
      setRequiredRole('MANAGER');
      setDescription('');
      queryClient.invalidateQueries({ queryKey: ['approval-rules'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      fetchJson(`/api/v1/approval-rules/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['approval-rules'] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const handleSave = () => {
    const min = Number(minAmount) || 0;
    const max = maxAmount.trim() === '' ? null : Number(maxAmount);
    if (max !== null && max <= min) { toast.error('Max amount must be greater than min amount'); return; }
    createMutation.mutate({ entityType, minAmount: min, maxAmount: max, requiredRole, description: description || undefined });
  };

  return (
    <Card>
      <CardHeader className="pb-3 flex-row items-center justify-between flex-wrap gap-3">
        <CardTitle className="text-base flex items-center gap-2"><GitBranch className="h-4 w-4 text-orange-600" /> Approval Workflow</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="bg-orange-600 hover:bg-orange-700"><Plus className="h-4 w-4 mr-1" /> Add Rule</Button>
          </DialogTrigger>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Add Approval Rule</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Applies To</Label>
                <Select value={entityType} onValueChange={setEntityType}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ENTITY_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Min Amount</Label>
                  <Input type="number" className="h-9" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Max Amount</Label>
                  <Input type="number" className="h-9" placeholder="Unbounded" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} />
                </div>
              </div>
              <div>
                <Label className="text-xs">Required Role *</Label>
                <Select value={requiredRole} onValueChange={setRequiredRole}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground mt-1">Admin can always approve, regardless of this setting.</p>
              </div>
              <div>
                <Label className="text-xs">Description</Label>
                <Input className="h-9" placeholder="e.g. Large orders need Manager sign-off" value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
              <Button className="w-full bg-orange-600 hover:bg-orange-700" disabled={createMutation.isPending} onClick={handleSave}>
                {createMutation.isPending ? 'Saving...' : 'Save Rule'}
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
        ) : (
          <>
            <div className="m-4 flex items-start gap-2 rounded-md border border-sky-200 bg-sky-50 p-3 text-xs text-sky-800">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <div>
                If no active rule covers an amount, Bizness-Ph-OS defaults to requiring <strong>Admin or Manager</strong> approval — approval is never wide open just because nothing&apos;s configured here yet.
              </div>
            </div>
            {rules.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>Applies To</TableHead><TableHead>Amount Range</TableHead><TableHead>Required Role</TableHead><TableHead>Description</TableHead><TableHead>Active</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {rules.map((rule) => (
                      <TableRow key={rule.id}>
                        <TableCell className="text-sm">{ENTITY_TYPES.find((t) => t.value === rule.entityType)?.label ?? rule.entityType}</TableCell>
                        <TableCell className="text-sm">{rule.minAmount.toLocaleString()} – {rule.maxAmount != null ? rule.maxAmount.toLocaleString() : '∞'}</TableCell>
                        <TableCell><Badge variant="secondary" className="text-xs">{rule.requiredRole}</Badge></TableCell>
                        <TableCell className="text-xs text-muted-foreground">{rule.description || '-'}</TableCell>
                        <TableCell>
                          <Switch
                            checked={rule.isActive}
                            onCheckedChange={(checked) => toggleMutation.mutate({ id: rule.id, isActive: checked })}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="p-8 text-center"><GitBranch className="h-10 w-10 mx-auto text-muted-foreground/30 mb-2" /><p className="text-sm text-muted-foreground">No custom rules yet — the Admin/Manager default applies to everything.</p></div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// =============================================================================
// ACCESS CONTROL (role <-> permission assignment)
// =============================================================================

function AccessControlSection({ queryClient }: { queryClient: ReturnType<typeof useQueryClient> }) {
  const [newPermName, setNewPermName] = useState('');
  const [newPermDesc, setNewPermDesc] = useState('');
  const [addPermFor, setAddPermFor] = useState<number | null>(null);
  const [pickPermId, setPickPermId] = useState('');

  const { data: roles = [], isLoading, isError, error } = useQuery<Role[]>({
    queryKey: ['roles-list'],
    queryFn: () => fetchJson<Role[]>('/api/v1/auth/roles'),
  });

  const { data: allPermissions = [] } = useQuery<Permission[]>({
    queryKey: ['permissions-list'],
    queryFn: () => fetchJson<Permission[]>('/api/v1/auth/permissions'),
  });

  const createPermMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetchJson('/api/v1/auth/permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success('Permission created!');
      setNewPermName('');
      setNewPermDesc('');
      queryClient.invalidateQueries({ queryKey: ['permissions-list'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const grantMutation = useMutation({
    mutationFn: ({ roleId, permissionId }: { roleId: number; permissionId: number }) =>
      fetchJson(`/api/v1/roles/${roleId}/permissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissionId }),
      }),
    onSuccess: () => {
      toast.success('Permission granted');
      setAddPermFor(null);
      setPickPermId('');
      queryClient.invalidateQueries({ queryKey: ['roles-list'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const revokeMutation = useMutation({
    mutationFn: ({ roleId, permissionId }: { roleId: number; permissionId: number }) =>
      fetchJson(`/api/v1/roles/${roleId}/permissions?permissionId=${permissionId}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Permission revoked');
      queryClient.invalidateQueries({ queryKey: ['roles-list'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-violet-600" /> Access Control</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isError ? (
            <ErrorBanner message={errorMessage(error)} />
          ) : isLoading ? (
            <div className="p-6 space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
          ) : roles.length > 0 ? (
            <div className="divide-y">
              {roles.map((role) => {
                const assignedIds = new Set(role.permissions.map((p) => p.id));
                const available = allPermissions.filter((p) => !assignedIds.has(p.id));
                return (
                  <div key={role.id} className="p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold">{role.roleName}</span>
                      <Badge variant="secondary" className="text-[10px]">{role.permissions.length} permission{role.permissions.length !== 1 ? 's' : ''}</Badge>
                    </div>
                    {role.description && <p className="text-xs text-muted-foreground mb-2">{role.description}</p>}
                    <div className="flex flex-wrap gap-1.5 items-center">
                      {role.permissions.map((p) => (
                        <Badge key={p.id} variant="outline" className="text-[10px] font-normal gap-1 pr-1">
                          {p.permissionName}
                          <button
                            type="button"
                            className="hover:text-rose-600"
                            onClick={() => revokeMutation.mutate({ roleId: role.id, permissionId: p.id })}
                          >
                            ×
                          </button>
                        </Badge>
                      ))}
                      {role.permissions.length === 0 && <span className="text-xs text-muted-foreground">No permissions assigned</span>}

                      {addPermFor === role.id ? (
                        <div className="flex items-center gap-1">
                          <Select value={pickPermId} onValueChange={setPickPermId}>
                            <SelectTrigger className="h-7 text-xs w-40"><SelectValue placeholder="Choose..." /></SelectTrigger>
                            <SelectContent>
                              {available.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.permissionName}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <Button
                            size="sm"
                            className="h-7 text-xs bg-violet-600 hover:bg-violet-700"
                            disabled={!pickPermId || grantMutation.isPending}
                            onClick={() => grantMutation.mutate({ roleId: role.id, permissionId: Number(pickPermId) })}
                          >
                            Grant
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setAddPermFor(null); setPickPermId(''); }}>Cancel</Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          disabled={available.length === 0}
                          onClick={() => setAddPermFor(role.id)}
                        >
                          <Plus className="h-3 w-3 mr-1" /> Add
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-8 text-center"><ShieldCheck className="h-10 w-10 mx-auto text-muted-foreground/30 mb-2" /><p className="text-sm text-muted-foreground">No roles found.</p></div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">Define a New Permission</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-2 flex-wrap">
            <div className="flex-1 min-w-40">
              <Label className="text-xs">Permission Name *</Label>
              <Input className="h-9" placeholder="e.g. APPROVE_LARGE_ORDERS" value={newPermName} onChange={(e) => setNewPermName(e.target.value.toUpperCase())} />
            </div>
            <div className="flex-1 min-w-40">
              <Label className="text-xs">Description</Label>
              <Input className="h-9" placeholder="What this allows" value={newPermDesc} onChange={(e) => setNewPermDesc(e.target.value)} />
            </div>
            <Button
              className="h-9 bg-violet-600 hover:bg-violet-700"
              disabled={!newPermName || createPermMutation.isPending}
              onClick={() => createPermMutation.mutate({ permissionName: newPermName, description: newPermDesc || undefined })}
            >
              {createPermMutation.isPending ? 'Creating...' : 'Create'}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">
            Note: permissions created here are available to assign to roles above, but most access checks in
            Bizness-Ph-OS today are role-based (e.g. &quot;Admin or Manager&quot;), not permission-based — this list is the
            foundation for finer-grained checks as they&apos;re added, not a replacement for the role checks already in place.
          </p>
        </CardContent>
      </Card>

      <PortalAccessSection />
    </div>
  );
}

// =============================================================================
// PORTAL ACCESS — per-user overrides on top of the role-based checks above.
// Pick a user, then set each portal to Not Allowed / View Only / View &
// Edit. Deliberately additive: a portal with no override here behaves
// exactly as it always has (whatever the user's Role permits) — see
// src/lib/portals.ts and the module-access API routes for how this stays
// safe by default rather than locking anyone out the moment it's used.
// =============================================================================

interface ModuleAccessUser {
  id: number;
  fullName: string;
  username: string;
  role?: { roleName: string };
}

interface ModuleAccessModule {
  moduleKey: string;
  label: string;
  accessLevel: ModuleAccessLevel | null;
}

function PortalAccessSection() {
  const queryClient = useQueryClient();
  const [selectedUserId, setSelectedUserId] = useState('');

  const { data: users = [] } = useQuery<ModuleAccessUser[]>({
    queryKey: ['users-for-module-access'],
    queryFn: () => fetchJson<ModuleAccessUser[]>('/api/v1/auth/users'),
  });

  const { data: accessData, isLoading, isError, error } = useQuery<{ userId: number; modules: ModuleAccessModule[] }>({
    queryKey: ['user-module-access', selectedUserId],
    queryFn: () => fetchJson(`/api/v1/auth/users/${selectedUserId}/module-access`),
    enabled: !!selectedUserId,
  });

  const setAccessMutation = useMutation({
    mutationFn: ({ moduleKey, accessLevel }: { moduleKey: string; accessLevel: string }) =>
      fetchJson(`/api/v1/auth/users/${selectedUserId}/module-access`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moduleKey, accessLevel }),
      }),
    onSuccess: () => {
      toast.success('Portal access updated');
      queryClient.invalidateQueries({ queryKey: ['user-module-access', selectedUserId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <LayoutGrid className="h-4 w-4 text-violet-600" /> Portal Access
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Per-user overrides for exactly which portals someone can see, and whether they can edit or only view within
          them — on top of (not instead of) the role-based checks above.
        </p>
      </CardHeader>
      <CardContent>
        <div className="max-w-xs mb-4">
          <Label className="text-xs">User</Label>
          <Select value={selectedUserId} onValueChange={setSelectedUserId}>
            <SelectTrigger className="h-9"><SelectValue placeholder="Choose a user..." /></SelectTrigger>
            <SelectContent>
              {users.map((u) => (
                <SelectItem key={u.id} value={String(u.id)}>{u.fullName} ({u.username}) — {u.role?.roleName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {!selectedUserId ? (
          <p className="text-sm text-muted-foreground">Select a user to configure their portal access.</p>
        ) : isError ? (
          <ErrorBanner message={errorMessage(error)} />
        ) : isLoading ? (
          <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : (
          <div className="divide-y border rounded-md">
            {accessData?.modules.map((m) => (
              <div key={m.moduleKey} className="flex items-center justify-between px-3 py-2">
                <span className="text-sm">{m.label}</span>
                <Select
                  value={m.accessLevel ?? 'DEFAULT'}
                  onValueChange={(v) => setAccessMutation.mutate({ moduleKey: m.moduleKey, accessLevel: v })}
                >
                  <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DEFAULT">Default (Role-based)</SelectItem>
                    {ACCESS_LEVELS.map((lvl) => (
                      <SelectItem key={lvl.value} value={lvl.value}>{lvl.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
// =============================================================================
// BRANCHES
// =============================================================================

interface BranchRow {
  id: string;
  name: string;
  address?: string | null;
  phone?: string | null;
  isActive: boolean;
}

const EMPTY_BRANCH_FORM = { id: '', name: '', address: '', phone: '' };

function BranchesSection({ queryClient }: { queryClient: ReturnType<typeof useQueryClient> }) {
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<BranchRow | null>(null);
  const [addForm, setAddForm] = useState(EMPTY_BRANCH_FORM);
  const [editForm, setEditForm] = useState({ name: '', address: '', phone: '' });

  const { data: branches = [], isLoading, isError, error } = useQuery<BranchRow[]>({
    queryKey: ['branches', 'all'],
    queryFn: () => fetchJson<BranchRow[]>('/api/v1/branches'),
  });

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetchJson('/api/v1/branches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success('Branch added!');
      setAddOpen(false);
      setAddForm(EMPTY_BRANCH_FORM);
      queryClient.invalidateQueries({ queryKey: ['branches'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      fetchJson(`/api/v1/branches/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success('Branch updated!');
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ['branches'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      fetchJson(`/api/v1/branches/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive }),
      }),
    onSuccess: (_data, variables) => {
      toast.success(variables.isActive ? 'Branch reactivated' : 'Branch deactivated');
      queryClient.invalidateQueries({ queryKey: ['branches'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openEdit = (branch: BranchRow) => {
    setEditing(branch);
    setEditForm({ name: branch.name, address: branch.address || '', phone: branch.phone || '' });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2"><Building2 className="h-4 w-4 text-amber-600" /> Branches</CardTitle>
          <Dialog open={addOpen} onOpenChange={(open) => { setAddOpen(open); if (!open) setAddForm(EMPTY_BRANCH_FORM); }}>
            <DialogTrigger asChild>
              <Button size="sm" className="h-8 bg-amber-600 hover:bg-amber-700">
                <Plus className="h-3.5 w-3.5 mr-1" /> Add Branch
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>Add Branch</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">Branch Code *</Label>
                  <Input
                    className="h-9 font-mono"
                    placeholder="e.g. BR-TAKORADI-03"
                    value={addForm.id}
                    onChange={(e) => setAddForm((f) => ({ ...f, id: e.target.value.toUpperCase() }))}
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">Uppercase letters, numbers, and hyphens only. Can&apos;t be changed later.</p>
                </div>
                <div>
                  <Label className="text-xs">Branch Name *</Label>
                  <Input className="h-9" placeholder="e.g. Takoradi Branch" value={addForm.name} onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">Address</Label>
                  <Input className="h-9" placeholder="Optional" value={addForm.address} onChange={(e) => setAddForm((f) => ({ ...f, address: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">Phone</Label>
                  <Input className="h-9" placeholder="Optional" value={addForm.phone} onChange={(e) => setAddForm((f) => ({ ...f, phone: e.target.value }))} />
                </div>
                <Button
                  className="w-full bg-amber-600 hover:bg-amber-700"
                  disabled={!addForm.id || !addForm.name || createMutation.isPending}
                  onClick={() => createMutation.mutate({
                    id: addForm.id,
                    name: addForm.name,
                    address: addForm.address || undefined,
                    phone: addForm.phone || undefined,
                  })}
                >
                  {createMutation.isPending ? 'Adding...' : 'Add Branch'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent className="p-0">
          {isError ? (
            <ErrorBanner message={errorMessage(error)} />
          ) : isLoading ? (
            <div className="p-6 space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
          ) : branches.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Address</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Active</TableHead>
                    <TableHead className="text-right">Edit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {branches.map((branch) => (
                    <TableRow key={branch.id} className={!branch.isActive ? 'opacity-60' : undefined}>
                      <TableCell className="font-mono text-xs">{branch.id}</TableCell>
                      <TableCell className="font-medium text-sm">{branch.name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{branch.address || '-'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{branch.phone || '-'}</TableCell>
                      <TableCell>
                        <Switch
                          checked={branch.isActive}
                          onCheckedChange={(checked) => toggleActiveMutation.mutate({ id: branch.id, isActive: checked })}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEdit(branch)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="p-8 text-center"><Building2 className="h-10 w-10 mx-auto text-muted-foreground/30 mb-2" /><p className="text-sm text-muted-foreground">No branches yet.</p></div>
          )}
        </CardContent>
      </Card>

      <p className="text-[10px] text-muted-foreground px-1">
        Deactivating a branch removes it from branch switchers and new-transfer pickers, but keeps its historical
        sales, inventory, and transfer records intact — branch codes are never deleted, only hidden going forward.
      </p>

      <Dialog open={!!editing} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit {editing?.id}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Branch Name *</Label>
              <Input className="h-9" value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Address</Label>
              <Input className="h-9" placeholder="Optional" value={editForm.address} onChange={(e) => setEditForm((f) => ({ ...f, address: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Phone</Label>
              <Input className="h-9" placeholder="Optional" value={editForm.phone} onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))} />
            </div>
            <Button
              className="w-full bg-amber-600 hover:bg-amber-700"
              disabled={!editForm.name || updateMutation.isPending || !editing}
              onClick={() => editing && updateMutation.mutate({
                id: editing.id,
                body: { name: editForm.name, address: editForm.address || null, phone: editForm.phone || null },
              })}
            >
              {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// =============================================================================
// COMPANY — name and logo shown in the sidebar for everyone signed into
// this company. Admin-only, since it's a "changes what everyone sees"
// setting, same tier as GL Mappings or Approval Workflow.
// =============================================================================

const MAX_LOGO_FILE_BYTES = 400_000; // raw file size before base64 inflation (~33%)

function CompanySection() {
  const queryClient = useQueryClient();
  const { data: company, isLoading, isError, error } = useCompany();
  const [name, setName] = useState('');
  const [logoPreview, setLogoPreview] = useState<string | null | undefined>(undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync local edit state once the company loads, same pattern used for
  // My Profile above — a pure local-state mirror of fetched data, safe
  // under Strict Mode's double-invocation since it's idempotent.
  useEffect(() => {
    if (company) {
      setName(company.name);
      setLogoPreview(company.logoUrl ?? null);
    }
  }, [company]);

  const updateMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetchJson('/api/v1/company', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success('Company updated!');
      queryClient.invalidateQueries({ queryKey: ['my-company'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Explicit allowlist, not a broad "image/*" check — deliberately
    // excludes SVG, which can contain embedded scripts. See
    // src/lib/logo-validation.ts for the same check enforced
    // server-side, which is what actually matters; this is
    // defense-in-depth, not the real boundary.
    if (!['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'].includes(file.type)) {
      toast.error('Please choose a PNG, JPEG, GIF, or WebP image');
      return;
    }
    if (file.size > MAX_LOGO_FILE_BYTES) {
      toast.error(`Image is too large — please use one under ${Math.round(MAX_LOGO_FILE_BYTES / 1000)}KB`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setLogoPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleSave = () => {
    if (!name) {
      toast.error('Company name is required');
      return;
    }
    updateMutation.mutate({ name, logoUrl: logoPreview ?? null });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2"><Image className="h-4 w-4 text-brand-600" /> Company</CardTitle>
        <p className="text-xs text-muted-foreground">Your company&apos;s name and logo, shown in the sidebar for everyone signed in.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {isError ? (
          <ErrorBanner message={errorMessage(error)} />
        ) : isLoading ? (
          <div className="space-y-3"><Skeleton className="h-9 w-full" /><Skeleton className="h-20 w-20" /></div>
        ) : (
          <>
            <div>
              <Label className="text-xs">Company Name</Label>
              <Input className="h-9 max-w-sm" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Logo</Label>
              <div className="flex items-center gap-4 mt-1">
                <div className="flex h-20 w-20 items-center justify-center rounded-lg border bg-muted/30 overflow-hidden flex-shrink-0">
                  {logoPreview ? (
                    // eslint-disable-next-line @next/next/no-img-element -- previewing a data URI, not a static asset
                    <img src={logoPreview} alt="Company logo" className="h-full w-full object-cover" />
                  ) : (
                    <Image className="h-8 w-8 text-muted-foreground/40" />
                  )}
                </div>
                <div className="space-y-2">
                  <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
                      <Upload className="h-3.5 w-3.5 mr-1" /> {logoPreview ? 'Change' : 'Upload'}
                    </Button>
                    {logoPreview && (
                      <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => setLogoPreview(null)}>
                        Remove
                      </Button>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground">PNG or JPG, under {Math.round(MAX_LOGO_FILE_BYTES / 1000)}KB.</p>
                </div>
              </div>
            </div>
            <Button className="bg-brand-600 hover:bg-brand-700" disabled={updateMutation.isPending} loading={updateMutation.isPending} onClick={handleSave}>
              {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
            {company?.trialExpiresAt && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 flex items-center justify-between gap-3 flex-wrap">
                <p className="text-xs text-amber-800">
                  This company still has a trial restriction from before trials were removed for new signups — it ends{' '}
                  {new Date(company.trialExpiresAt).toLocaleDateString()}.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-amber-400 text-amber-800 hover:bg-amber-100"
                  disabled={updateMutation.isPending}
                  onClick={() => updateMutation.mutate({ trialExpiresAt: null })}
                >
                  Remove Trial Restriction
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
