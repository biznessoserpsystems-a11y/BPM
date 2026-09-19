'use client';

import { useEffect, useRef } from 'react';
import { usePharmacyStore, authFetch } from '@/lib/store';
import { useBranches } from '@/hooks/use-branches';
import { useModuleAccess } from '@/hooks/use-module-access';
import { useCompany } from '@/hooks/use-company';
import { daysUntilTrialExpiry } from '@/lib/company-trial';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { SidebarNav } from './sidebar-nav';
import { LoginOverlay } from './login-overlay';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { ShoppingCart, LogOut } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { toast } from 'sonner';

import { DashboardView } from '@/components/views/dashboard-view';
import { PosView } from '@/components/views/pos-view';
import { InventoryView } from '@/components/views/inventory-view';
import { WarehouseView } from '@/components/views/warehouse-view';
import { ProcurementView } from '@/components/views/procurement-view';
import { PrescriptionsView } from '@/components/views/prescriptions-view';
import { TransfersView } from '@/components/views/transfers-view';
import { CatalogView } from '@/components/views/catalog-view';
import { AccountingView } from '@/components/views/accounting-view';
import { PayrollView } from '@/components/views/payroll-view';
import { ReportsView } from '@/components/views/reports-view';
import { UsersView } from '@/components/views/users-view';
import { AuditView } from '@/components/views/audit-view';
import { SettingsView } from '@/components/views/settings-view';

// Expose authFetch globally for all view components
if (typeof window !== 'undefined') {
  (window as unknown as { authFetch: typeof authFetch }).authFetch = authFetch;
}

const viewComponents: Record<string, React.ComponentType> = {
  dashboard: DashboardView,
  pos: PosView,
  inventory: InventoryView,
  warehouse: WarehouseView,
  procurement: ProcurementView,
  prescriptions: PrescriptionsView,
  transfers: TransfersView,
  catalog: CatalogView,
  accounting: AccountingView,
  payroll: PayrollView,
  reports: ReportsView,
  users: UsersView,
  audit: AuditView,
  settings: SettingsView,
};

const viewTitles: Record<string, string> = {
  dashboard: 'Dashboard',
  pos: 'Point of Sale',
  inventory: 'Inventory',
  warehouse: 'Warehouse',
  procurement: 'Procurement',
  prescriptions: 'Prescriptions',
  transfers: 'Transfers',
  catalog: 'Catalog',
  accounting: 'Accounting',
  reports: 'Reports',
  users: 'Users',
  audit: 'Audit Log',
  settings: 'Settings',
};

export function AppShell() {
  const {
    isAuthenticated,
    user,
    activeView,
    setView,
    selectedBranchId,
    setBranch,
    posCart,
    logout,
    restoreSession,
  } = usePharmacyStore();

  // Restore session on mount
  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  // If a Portal Access override removes the currently-open view (set
  // while it was already open, or just after logging in on a stale
  // activeView), redirect away rather than leaving it rendered — hiding
  // the sidebar item alone doesn't stop already-open content from
  // showing.
  const { canView, isLoading: moduleAccessLoading } = useModuleAccess();
  const { data: company } = useCompany();
  const trialDaysLeft = daysUntilTrialExpiry(company?.trialExpiresAt ? new Date(company.trialExpiresAt) : null);
  const prefersReducedMotion = useReducedMotion();
  // Tracks the last activeView this effect actually redirected away from,
  // so a redirect for a given view only ever fires once *in a row* —
  // independent of whether canView/moduleAccessLoading happen to get new
  // references on a re-render for any reason (a subtly unstable memoized
  // callback, a query refetch, anything). A previous version of this
  // effect relied entirely on canView being referentially stable and on
  // activeView reaching 'dashboard' to naturally break the cycle; in
  // practice that wasn't airtight enough and produced a real "Maximum
  // update depth exceeded" loop. This ref makes the loop structurally
  // impossible rather than merely unlikely. It's cleared the moment
  // activeView moves on to something else, so a genuine second attempt
  // to reach the same blocked view later is still caught correctly —
  // it only ever suppresses an immediate, same-render-cycle repeat.
  const redirectedFrom = useRef<string | null>(null);
  useEffect(() => {
    if (moduleAccessLoading) return;
    if (redirectedFrom.current !== null && redirectedFrom.current !== activeView) {
      redirectedFrom.current = null;
    }
    if (redirectedFrom.current === activeView) return;
    if (activeView !== 'dashboard' && !canView(activeView)) {
      redirectedFrom.current = activeView;
      setView('dashboard');
    }
  }, [activeView, moduleAccessLoading, canView, setView]);

  // Without this, switching views while scrolled down (e.g. deep in a
  // long Inventory batch list, then clicking Reports) lands the new view
  // already scrolled halfway down the page — the whole app shares one
  // window scroll position, not a per-view one. Smooth unless the person
  // has reduced motion set, matching the same preference respected for
  // the page-transition animation just below.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
  }, [activeView, prefersReducedMotion]);

  const ViewComponent = viewComponents[activeView] || DashboardView;
  const cartCount = posCart.reduce((sum, item) => sum + item.quantity, 0);
  const { branches } = useBranches();

  if (!isAuthenticated) {
    return <LoginOverlay />;
  }

  const initials = user?.fullName
    ? user.fullName.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
    : 'U';

  return (
    <SidebarProvider>
      <SidebarNav />
      <SidebarInset>
        <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-4 md:px-6">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <h1 className="text-sm font-semibold md:text-base">{viewTitles[activeView]}</h1>
          <div className="ml-auto flex items-center gap-3">
            {activeView === 'pos' && cartCount > 0 && (
              <Badge variant="default" className="bg-brand-600 hover:bg-brand-700 gap-1">
                <ShoppingCart className="h-3 w-3" />
                {cartCount}
              </Badge>
            )}
            <Select value={selectedBranchId} onValueChange={setBranch}>
              <SelectTrigger className="w-[160px] h-8 text-xs">
                <SelectValue placeholder="Select branch" />
              </SelectTrigger>
              <SelectContent>
                {branches.map((branch) => (
                  <SelectItem key={branch.id} value={branch.id}>
                    {branch.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-rose-600"
              onClick={() => {
                logout();
                toast.info('Signed out');
              }}
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </header>
        {trialDaysLeft !== null && trialDaysLeft <= 7 && (
          <div
            className={`px-4 py-2 md:px-6 text-center text-xs font-medium ${
              trialDaysLeft <= 0
                ? 'bg-rose-600 text-white'
                : trialDaysLeft <= 2
                  ? 'bg-rose-50 text-rose-700 border-b border-rose-200'
                  : 'bg-amber-50 text-amber-800 border-b border-amber-200'
            }`}
          >
            {trialDaysLeft <= 0
              ? "Your company's trial has ended — anyone signing out won't be able to sign back in until it's extended."
              : `Your company's trial ends in ${trialDaysLeft} day${trialDaysLeft === 1 ? '' : 's'}.`}
          </div>
        )}
        <main className="flex-1 p-4 md:p-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeView}
              initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={prefersReducedMotion ? undefined : { opacity: 0, y: -8 }}
              transition={{ duration: prefersReducedMotion ? 0 : 0.2 }}
            >
              <ViewComponent />
            </motion.div>
          </AnimatePresence>
        </main>
        <footer className="border-t px-4 py-3 md:px-6 text-center text-xs text-muted-foreground">
          Bizness-Ph-OS &copy; {new Date().getFullYear()}
        </footer>
      </SidebarInset>
    </SidebarProvider>
  );
}
