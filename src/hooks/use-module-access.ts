'use client';

import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '@/lib/fetch-json';
import type { ModuleAccessLevel, PortalKey } from '@/lib/portals';

interface ModuleAccessEntry {
  moduleKey: string;
  accessLevel: ModuleAccessLevel | null;
}

/**
 * `accessLevel` is null for any portal with no explicit override — that
 * means "inherited," i.e. full access exactly as it works without this
 * feature at all (whatever the user's Role already permits elsewhere).
 * Only an explicit NONE/VIEW override actually restricts anything; this
 * hook never invents a restriction that wasn't set in Settings → Access
 * Control → Portal Access.
 */
export function useModuleAccess() {
  const { data, isLoading } = useQuery<{ modules: ModuleAccessEntry[] }>({
    queryKey: ['my-module-access'],
    queryFn: () => fetchJson<{ modules: ModuleAccessEntry[] }>('/api/v1/auth/me/module-access'),
    staleTime: 60_000,
  });

  // Memoized against `data` specifically (not recreated on every render
  // regardless of whether the underlying data changed) — callers like
  // app-shell.tsx put `canView` directly in a useEffect dependency array,
  // and a function that's a new reference every render defeats the whole
  // point of that array: React sees "a dependency changed" on every
  // single render and re-runs the effect every time, which is exactly
  // the shape of bug that causes an infinite update loop the moment that
  // effect ever calls a state setter.
  const levelOf = useCallback(
    (moduleKey: PortalKey | string): ModuleAccessLevel | null =>
      data?.modules.find((m) => m.moduleKey === moduleKey)?.accessLevel ?? null,
    [data]
  );
  const canView = useCallback((moduleKey: PortalKey | string) => levelOf(moduleKey) !== 'NONE', [levelOf]);
  const canEdit = useCallback((moduleKey: PortalKey | string) => {
    const level = levelOf(moduleKey);
    return level !== 'NONE' && level !== 'VIEW';
  }, [levelOf]);

  return { isLoading, levelOf, canView, canEdit };
}
