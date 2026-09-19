'use client';

import { useQuery } from '@tanstack/react-query';
import { authFetch } from '@/lib/store';
import type { CurrencyInfo } from '@/lib/currency';

/**
 * Returns the currently configured base currency (see the Accounting →
 * Currencies tab), or null while it's still loading / if none is set yet.
 * Uses the same ['currencies'] query key as the Accounting view, so
 * react-query dedupes and shares this fetch across the whole app instead
 * of every view re-requesting it independently — and switching the base
 * currency there invalidates this everywhere else automatically.
 */
export function useBaseCurrency(): CurrencyInfo | null {
  const { data: currencies } = useQuery<CurrencyInfo[]>({
    queryKey: ['currencies'],
    queryFn: async () => {
      const res = await authFetch('/api/v1/currencies');
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error((body && body.error) || 'Failed to load currencies');
      }
      return body as CurrencyInfo[];
    },
    staleTime: 60_000,
  });

  return currencies?.find((c) => c.isBaseCurrency) ?? null;
}
