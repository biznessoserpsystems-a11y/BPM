'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { SearchInput } from '@/components/ui/search-input';
import { Label } from '@/components/ui/label';
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
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Users as UsersIcon, Plus, KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { fetchJson } from '@/lib/fetch-json';
import { ErrorBanner, errorMessage } from '@/components/ui/error-banner';
import { usePharmacyStore } from '@/lib/store';
import { useBranches } from '@/hooks/use-branches';

interface Role {
  id: number;
  roleName: string;
}

interface User {
  id: number;
  username: string;
  fullName: string;
  email?: string;
  phone?: string;
  isActive: boolean;
  homeBranchId: string;
  licenseNumber?: string;
  role?: { id: number; roleName: string; description?: string };
}

const roleColors: Record<string, string> = {
  ADMIN: 'bg-rose-50 text-rose-700 border-rose-200',
  MANAGER: 'bg-amber-50 text-amber-700 border-amber-200',
  EMPLOYEE: 'bg-brand-50 text-brand-700 border-brand-200',
};

const emptyNewUser = {
  username: '',
  password: '',
  fullName: '',
  email: '',
  phone: '',
  roleId: '',
  homeBranchId: '',
  licenseNumber: '',
};

export function UsersView() {
  const queryClient = useQueryClient();
  const { user: currentUser } = usePharmacyStore();
  const canManageAccess = currentUser?.roleName === 'ADMIN' || currentUser?.roleName === 'MANAGER';
  // Creating a new account and assigning its role are Admin-exclusive —
  // deliberately narrower than canManageAccess above, which still governs
  // the merely-administrative stuff Manager retains (deactivating an
  // account, resetting a forgotten password).
  const canAssignRoles = currentUser?.roleName === 'ADMIN';
  const { branches } = useBranches();
  const [userSearch, setUserSearch] = useState('');

  const { data: users = [], isLoading, isError, error } = useQuery<User[]>({
    queryKey: ['users-list'],
    queryFn: () => fetchJson<User[]>('/api/v1/auth/users'),
  });

  const filteredUsers = users.filter((u) => {
    const q = userSearch.toLowerCase();
    if (!q) return true;
    return (
      u.fullName.toLowerCase().includes(q) ||
      u.username.toLowerCase().includes(q) ||
      (u.email?.toLowerCase().includes(q) ?? false) ||
      (u.role?.roleName.toLowerCase().includes(q) ?? false)
    );
  });

  const { data: roles = [] } = useQuery<Role[]>({
    queryKey: ['roles-list-users'],
    queryFn: () => fetchJson<Role[]>('/api/v1/auth/roles'),
    enabled: canAssignRoles,
  });

  const accessMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      fetchJson(`/api/v1/auth/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: (_, variables) => {
      if (variables.body.isActive === false) toast.success('User deactivated');
      else if (variables.body.isActive === true) toast.success('User reactivated');
      else if (variables.body.roleId !== undefined) toast.success('Role updated');
      else toast.success('User access updated');
      queryClient.invalidateQueries({ queryKey: ['users-list'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ---------------------------------------------------------------------------
  // Add User
  // ---------------------------------------------------------------------------

  const [addUserOpen, setAddUserOpen] = useState(false);
  const [newUser, setNewUser] = useState(emptyNewUser);

  const createUserMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetchJson('/api/v1/auth/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success('User created!');
      setAddUserOpen(false);
      setNewUser(emptyNewUser);
      queryClient.invalidateQueries({ queryKey: ['users-list'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleCreateUser = () => {
    if (!newUser.username || !newUser.password || !newUser.fullName || !newUser.roleId) {
      toast.error('Username, password, full name, and role are required');
      return;
    }
    createUserMutation.mutate({
      username: newUser.username,
      password: newUser.password,
      fullName: newUser.fullName,
      email: newUser.email || undefined,
      phone: newUser.phone || undefined,
      roleId: Number(newUser.roleId),
      homeBranchId: newUser.homeBranchId || undefined,
      licenseNumber: newUser.licenseNumber || undefined,
    });
  };

  // ---------------------------------------------------------------------------
  // Reset Password
  // ---------------------------------------------------------------------------

  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<User | null>(null);
  const [resetPassword, setResetPassword] = useState('');

  const resetPasswordMutation = useMutation({
    mutationFn: ({ id, newPassword }: { id: number; newPassword: string }) =>
      fetchJson(`/api/v1/auth/users/${id}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword }),
      }),
    onSuccess: () => {
      toast.success(`Password reset for ${resetTarget?.fullName}`);
      setResetTarget(null);
      setResetPassword('');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <Card>
      <CardHeader className="pb-3 flex-row items-center justify-between flex-wrap gap-3">
        <CardTitle className="text-base flex items-center gap-2">
          <UsersIcon className="h-4 w-4 text-brand-600" />
          Users & Staff
        </CardTitle>
        {canAssignRoles && (
          <Dialog open={addUserOpen} onOpenChange={setAddUserOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="bg-brand-600 hover:bg-brand-700">
                <Plus className="h-4 w-4 mr-1" /> Add User
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Add User</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">Username *</Label>
                  <Input className="h-9" value={newUser.username} onChange={(e) => setNewUser((f) => ({ ...f, username: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">Password *</Label>
                  <PasswordInput className="h-9" value={newUser.password} onChange={(v) => setNewUser((f) => ({ ...f, password: v }))} autoComplete="new-password" />
                  <p className="text-[10px] text-muted-foreground mt-1">At least 8 characters, with uppercase, lowercase, and a number.</p>
                </div>
                <div>
                  <Label className="text-xs">Full Name *</Label>
                  <Input className="h-9" value={newUser.fullName} onChange={(e) => setNewUser((f) => ({ ...f, fullName: e.target.value }))} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Email</Label>
                    <Input type="email" className="h-9" value={newUser.email} onChange={(e) => setNewUser((f) => ({ ...f, email: e.target.value }))} />
                  </div>
                  <div>
                    <Label className="text-xs">Phone</Label>
                    <Input className="h-9" value={newUser.phone} onChange={(e) => setNewUser((f) => ({ ...f, phone: e.target.value }))} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Role *</Label>
                    <Select value={newUser.roleId} onValueChange={(v) => setNewUser((f) => ({ ...f, roleId: v }))}>
                      <SelectTrigger className="h-9"><SelectValue placeholder="Select role" /></SelectTrigger>
                      <SelectContent>
                        {roles.map((r) => <SelectItem key={r.id} value={String(r.id)}>{r.roleName}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Home Branch</Label>
                    <Select value={newUser.homeBranchId} onValueChange={(v) => setNewUser((f) => ({ ...f, homeBranchId: v }))}>
                      <SelectTrigger className="h-9"><SelectValue placeholder="Select branch" /></SelectTrigger>
                      <SelectContent>
                        {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label className="text-xs">License Number</Label>
                  <Input className="h-9" placeholder="Optional — for pharmacists" value={newUser.licenseNumber} onChange={(e) => setNewUser((f) => ({ ...f, licenseNumber: e.target.value }))} />
                </div>
                <Button className="w-full bg-brand-600 hover:bg-brand-700" disabled={createUserMutation.isPending} onClick={handleCreateUser}>
                  {createUserMutation.isPending ? 'Creating...' : 'Create User'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      <CardContent className="p-0">
        <div className="p-4 border-b">
          <SearchInput
            className="max-w-sm"
            placeholder="Search by name, username, email, or role..."
            value={userSearch}
            onChange={setUserSearch}
          />
        </div>
        {isError ? (
          <ErrorBanner message={errorMessage(error)} />
        ) : isLoading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : filteredUsers.length > 0 ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Username</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>License</TableHead>
                  <TableHead>Status</TableHead>
                  {canManageAccess && <TableHead>Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className={cn(
                            'text-xs font-bold',
                            user.isActive ? 'bg-brand-100 text-brand-700' : 'bg-gray-100 text-gray-500'
                          )}>
                            {getInitials(user.fullName)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="text-sm font-medium">{user.fullName}</p>
                          {user.email && <p className="text-xs text-muted-foreground">{user.email}</p>}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm font-mono">{user.username}</TableCell>
                    <TableCell>
                      {canAssignRoles ? (
                        <Select
                          value={user.role?.id ? String(user.role.id) : ''}
                          onValueChange={(v) => accessMutation.mutate({ id: user.id, body: { roleId: Number(v) } })}
                        >
                          <SelectTrigger className="h-7 w-32 text-xs">
                            <SelectValue>
                              <Badge
                                variant="outline"
                                className={cn('text-xs', roleColors[user.role?.roleName || ''] || 'bg-gray-50 text-gray-600 border-gray-200')}
                              >
                                {user.role?.roleName || 'Unknown'}
                              </Badge>
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {roles.map((r) => <SelectItem key={r.id} value={String(r.id)}>{r.roleName}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge
                          variant="outline"
                          className={cn('text-xs', roleColors[user.role?.roleName || ''] || 'bg-gray-50 text-gray-600 border-gray-200')}
                        >
                          {user.role?.roleName || 'Unknown'}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {user.homeBranchId || '-'}
                    </TableCell>
                    <TableCell className="text-sm">
                      {user.phone || '-'}
                    </TableCell>
                    <TableCell className="text-xs font-mono">
                      {user.licenseNumber ? (
                        <span className="px-1.5 py-0.5 rounded bg-brand-50 text-brand-800 border border-brand-200">{user.licenseNumber}</span>
                      ) : '-'}
                    </TableCell>
                    <TableCell>
                      {canManageAccess ? (
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={user.isActive}
                            disabled={user.id === currentUser?.id}
                            onCheckedChange={(checked) => {
                              // Reactivating is low-risk and fires immediately;
                              // deactivating locks a colleague out of the
                              // system right away, so that direction alone
                              // gets a confirmation step first.
                              if (checked) {
                                accessMutation.mutate({ id: user.id, body: { isActive: true } });
                              } else {
                                setDeactivateTarget(user);
                              }
                            }}
                          />
                          <span className="text-xs text-muted-foreground">{user.isActive ? 'Active' : 'Inactive'}</span>
                        </div>
                      ) : (
                        <Badge
                          variant={user.isActive ? 'default' : 'secondary'}
                          className={cn('text-xs', user.isActive && 'bg-brand-100 text-brand-700')}
                        >
                          {user.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      )}
                    </TableCell>
                    {canManageAccess && (
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => setResetTarget(user)}
                        >
                          <KeyRound className="h-3 w-3 mr-1" /> Reset Password
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
            <UsersIcon className="h-10 w-10 mx-auto text-muted-foreground/30 mb-2" />
            <p className="text-sm text-muted-foreground">
              {userSearch ? `No users match "${userSearch}".` : 'No users found.'}
            </p>
          </div>
        )}
      </CardContent>

      <Dialog open={!!resetTarget} onOpenChange={(open) => { if (!open) { setResetTarget(null); setResetPassword(''); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Reset Password — {resetTarget?.fullName}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              This immediately replaces {resetTarget?.username}&apos;s password. They&apos;ll need to be told the new one directly — there&apos;s no email/reset-link flow in this app.
            </p>
            <div>
              <Label className="text-xs">New Password *</Label>
              <PasswordInput className="h-9" value={resetPassword} onChange={setResetPassword} autoComplete="new-password" />
              <p className="text-[10px] text-muted-foreground mt-1">At least 8 characters, with uppercase, lowercase, and a number.</p>
            </div>
            <Button
              className="w-full bg-brand-600 hover:bg-brand-700"
              disabled={resetPasswordMutation.isPending}
              onClick={() => {
                if (!resetPassword) { toast.error('Enter a new password'); return; }
                if (resetTarget) resetPasswordMutation.mutate({ id: resetTarget.id, newPassword: resetPassword });
              }}
            >
              {resetPasswordMutation.isPending ? 'Resetting...' : 'Reset Password'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deactivateTarget} onOpenChange={(open) => { if (!open) setDeactivateTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate {deactivateTarget?.fullName}?</AlertDialogTitle>
            <AlertDialogDescription>
              They&apos;ll be signed out and unable to log back in until reactivated. This doesn&apos;t affect any of
              their past sales, prescriptions, or other records — only their ability to sign in.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 hover:bg-rose-700 focus:ring-rose-600"
              onClick={() => {
                if (deactivateTarget) {
                  accessMutation.mutate({ id: deactivateTarget.id, body: { isActive: false } });
                }
                setDeactivateTarget(null);
              }}
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
