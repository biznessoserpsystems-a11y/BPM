import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '@/lib/fetch-json';

export interface Branch {
  id: string;
  name: string;
  address?: string | null;
  phone?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// Static fallback so branch pickers render something sensible before the
// query resolves (or if it's still loading on first paint). Empty, not a
// canned example branch — the real list (or "no branches yet" empty
// state) takes over everywhere this hook is used once
// `/api/v1/branches` responds.
const FALLBACK_BRANCHES: Branch[] = [];

/**
 * All branches (active and inactive) — used by the Branches settings
 * management table, which needs to show/reactivate inactive branches too.
 */
export function useAllBranches() {
  return useQuery<Branch[]>({
    queryKey: ['branches', 'all'],
    queryFn: () => fetchJson<Branch[]>('/api/v1/branches'),
    placeholderData: FALLBACK_BRANCHES,
  });
}

/**
 * Active branches only, shaped as {id, label} — for the branch switcher,
 * transfer picker, and user home-branch assignment dropdowns.
 */
export function useBranches() {
  const query = useAllBranches();
  const branches = (query.data ?? FALLBACK_BRANCHES)
    .filter((b) => b.isActive)
    .map((b) => ({ id: b.id, label: b.name }));
  return { ...query, branches };
}
