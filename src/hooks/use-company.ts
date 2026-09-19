'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '@/lib/fetch-json';

export interface CompanyInfo {
  id: string;
  name: string;
  code: string;
  logoUrl?: string | null;
  trialExpiresAt?: string | null;
}

export function useCompany() {
  return useQuery<CompanyInfo>({
    queryKey: ['my-company'],
    queryFn: () => fetchJson<CompanyInfo>('/api/v1/company'),
    staleTime: 60_000,
  });
}
