'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePharmacyStore } from '@/lib/store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { ClipboardList, Search, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { fetchJson } from '@/lib/fetch-json';
import { ErrorBanner, errorMessage } from '@/components/ui/error-banner';

interface AuditLog {
  id: number;
  userId: number;
  user?: { fullName: string; username: string };
  action: string;
  entityName: string;
  entityId?: string;
  details?: Record<string, unknown>;
  branchId?: string;
  createdAt: string;
}

const entityOptions = [
  'ALL',
  'Product',
  'ProductBatch',
  'Sale',
  'Prescription',
  'Transfer',
  'User',
  'Supplier',
  'StockAdjustment',
];

const actionColors: Record<string, string> = {
  CREATE: 'bg-brand-50 text-brand-700',
  UPDATE: 'bg-amber-50 text-amber-700',
  DELETE: 'bg-rose-50 text-rose-700',
  LOGIN: 'bg-sky-50 text-sky-700',
  SALE: 'bg-brand-50 text-brand-700',
  APPROVE: 'bg-sky-50 text-sky-700',
  DISPATCH: 'bg-purple-50 text-purple-700',
  RECEIVE: 'bg-brand-50 text-brand-700',
  REJECT: 'bg-rose-50 text-rose-700',
  CANCEL: 'bg-gray-100 text-gray-600',
  ADJUST: 'bg-amber-50 text-amber-700',
};

export function AuditView() {
  const { selectedBranchId } = usePharmacyStore();
  const [entityFilter, setEntityFilter] = useState('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const { data: logs = [], isLoading, isError, error, refetch, isRefetching } = useQuery<AuditLog[]>({
    queryKey: ['audit-logs', selectedBranchId, entityFilter, dateFrom, dateTo],
    queryFn: () => {
      const params = new URLSearchParams({ branchId: selectedBranchId, limit: '100' });
      if (entityFilter !== 'ALL') params.set('entityName', entityFilter);
      return fetchJson<AuditLog[]>(`/api/v1/audit-logs?${params.toString()}`);
    },
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-brand-600" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label className="text-xs">Entity</Label>
              <Select value={entityFilter} onValueChange={setEntityFilter}>
                <SelectTrigger className="w-[160px] h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {entityOptions.map((e) => (
                    <SelectItem key={e} value={e}>{e === 'ALL' ? 'All Entities' : e}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">From</Label>
              <Input type="date" className="w-[150px] h-9" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">To</Label>
              <Input type="date" className="w-[150px] h-9" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-9"
              onClick={() => refetch()}
              disabled={isRefetching}
            >
              <RotateCcw className={cn('h-3.5 w-3.5 mr-1', isRefetching && 'animate-spin')} />
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Search className="h-4 w-4 text-brand-600" />
              Audit Log
            </span>
            {logs && <span className="text-xs font-normal text-muted-foreground">{logs.length} entries</span>}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isError ? (
            <ErrorBanner message={errorMessage(error)} />
          ) : isLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : logs.length > 0 ? (
            <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>Entity ID</TableHead>
                    <TableHead>Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="text-xs text-muted-foreground">{log.id}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {format(new Date(log.createdAt), 'MMM d, HH:mm:ss')}
                      </TableCell>
                      <TableCell className="text-sm">
                        {log.user?.fullName || `User #${log.userId}`}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={cn('text-[10px]', actionColors[log.action.toUpperCase()] || 'bg-gray-50 text-gray-600')}
                        >
                          {log.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{log.entityName}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {log.entityId ? String(log.entityId).slice(0, 8) : '-'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-48 truncate">
                        {log.details ? JSON.stringify(log.details).slice(0, 60) : '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="p-8 text-center">
              <ClipboardList className="h-10 w-10 mx-auto text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">No audit log entries found.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
