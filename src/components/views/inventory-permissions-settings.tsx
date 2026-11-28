'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { PackageCheck } from 'lucide-react';
import { fetchJson } from '@/lib/fetch-json';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ErrorBanner, errorMessage } from '@/components/ui/error-banner';

interface DirectoryUser {
  id: number;
  fullName: string;
  username: string;
  role?: { roleName: string };
}

interface PermissionRow {
  key: string;
  label: string;
  description: string;
  roleDefault: boolean;
  setting: 'ALLOW' | 'DENY' | null;
  effective: boolean;
}

interface PermissionsView {
  userId: number;
  roleName: string;
  locked: boolean;
  permissions: PermissionRow[];
}

/**
 * Settings → Access Control → Inventory Permissions (Admin only).
 *
 * Who may edit received batches, change expiry dates, and make stock
 * adjustments. For each person an Admin can leave the role's default, GRANT
 * it, or TAKE IT AWAY. Unlike Portal Access, these are enforced by the server
 * (src/lib/inventory-permissions.ts), and a change applies immediately.
 */
export function InventoryPermissionsSection() {
  const queryClient = useQueryClient();
  const [selectedUserId, setSelectedUserId] = useState('');

  const { data: users = [] } = useQuery<DirectoryUser[]>({
    queryKey: ['users-for-inventory-permissions'],
    queryFn: () => fetchJson<DirectoryUser[]>('/api/v1/auth/users'),
  });
  // Administrators always have everything, so there's nothing to set for them.
  const people = users.filter((u) => u.role?.roleName !== 'ADMIN');

  const { data, isLoading, isError, error } = useQuery<PermissionsView>({
    queryKey: ['user-inventory-permissions', selectedUserId],
    queryFn: () => fetchJson<PermissionsView>(`/api/v1/auth/users/${selectedUserId}/permissions`),
    enabled: !!selectedUserId,
  });

  const mutation = useMutation({
    mutationFn: ({ permission, setting }: { permission: string; setting: string }) =>
      fetchJson(`/api/v1/auth/users/${selectedUserId}/permissions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permission, setting }),
      }),
    onSuccess: () => {
      toast.success('Permission updated');
      queryClient.invalidateQueries({ queryKey: ['user-inventory-permissions', selectedUserId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <PackageCheck className="h-4 w-4 text-slate-600" /> Inventory Permissions
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Choose who can edit received stock, change expiry dates, and make stock adjustments. Leave a person on their
          role&apos;s default, grant them something their role doesn&apos;t include, or take away something it does.
          Changes apply straight away and are recorded in the Audit Log. Only an Admin can change these — and
          Administrators always have all of them.
        </p>
      </CardHeader>
      <CardContent>
        <div className="max-w-xs mb-4">
          <Label className="text-xs">User</Label>
          <Select value={selectedUserId} onValueChange={setSelectedUserId}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Choose a user..." />
            </SelectTrigger>
            <SelectContent>
              {people.map((u) => (
                <SelectItem key={u.id} value={String(u.id)}>
                  {u.fullName} ({u.username}) — {u.role?.roleName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {!selectedUserId ? (
          <p className="text-sm text-muted-foreground">
            {people.length === 0 ? 'No other users yet — add staff in Users first.' : 'Select a user to see and change what they can do.'}
          </p>
        ) : isError ? (
          <ErrorBanner message={errorMessage(error)} />
        ) : isLoading || !data ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : (
          <div className="divide-y rounded-md border">
            {data.permissions.map((p) => (
              <div key={p.key} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="min-w-0 flex-1 basis-64">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{p.label}</span>
                    <Badge variant={p.effective ? 'default' : 'secondary'} className="text-[10px]">
                      {p.effective ? 'Can do this' : 'Cannot'}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{p.description}</p>
                </div>
                <Select
                  value={p.setting ?? 'DEFAULT'}
                  onValueChange={(setting) => mutation.mutate({ permission: p.key, setting })}
                  disabled={mutation.isPending}
                >
                  <SelectTrigger className="h-9 w-56" aria-label={`${p.label} — setting`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DEFAULT">
                      Role default ({p.roleDefault ? 'allowed' : 'not allowed'})
                    </SelectItem>
                    <SelectItem value="ALLOW">Allowed</SelectItem>
                    <SelectItem value="DENY">Not allowed</SelectItem>
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
