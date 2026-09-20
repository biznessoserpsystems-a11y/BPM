'use client';

import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  FileText,
  ArrowLeftRight,
  BookOpen,
  Users,
  ClipboardList,
  Landmark,
  Wallet,
  BarChart3,
  ClipboardCheck,
  Settings,
  Warehouse,
} from 'lucide-react';
import { usePharmacyStore } from '@/lib/store';
import { useModuleAccess } from '@/hooks/use-module-access';
import { useCompany } from '@/hooks/use-company';
import { cn } from '@/lib/utils';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  SidebarRail,
} from '@/components/ui/sidebar';

const navItems = [
  { view: 'dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { view: 'pos', icon: ShoppingCart, label: 'Point of Sale' },
  { view: 'inventory', icon: Package, label: 'Inventory' },
  { view: 'warehouse', icon: Warehouse, label: 'Warehouse' },
  { view: 'procurement', icon: ClipboardCheck, label: 'Procurement' },
  { view: 'prescriptions', icon: FileText, label: 'Prescriptions' },
  { view: 'transfers', icon: ArrowLeftRight, label: 'Transfers' },
  { view: 'catalog', icon: BookOpen, label: 'Catalog' },
  { view: 'accounting', icon: Landmark, label: 'Accounting' },
  { view: 'payroll', icon: Wallet, label: 'Payroll', roles: ['ADMIN', 'MANAGER'] },
  { view: 'reports', icon: BarChart3, label: 'Reports' },
  // Both hit endpoints that are Admin/Manager-only on the backend (the
  // unfiltered staff directory, the system audit log) — hidden here too so
  // Pharmacist/Technician aren't shown a nav item that just 403s.
  { view: 'users', icon: Users, label: 'Users', roles: ['ADMIN', 'MANAGER'] },
  { view: 'audit', icon: ClipboardList, label: 'Audit Log', roles: ['ADMIN', 'MANAGER'] },
  { view: 'settings', icon: Settings, label: 'Settings' },
];

export function SidebarNav() {
  const { activeView, setView, user } = usePharmacyStore();
  const { canView } = useModuleAccess();
  const { data: company } = useCompany();
  // Two independent filters, both must pass: the existing role-based one
  // (unchanged — some portals are Admin/Manager-only regardless of any
  // per-user override) and the new per-user Portal Access override, which
  // only ever *removes* a portal a role would otherwise show — a user
  // with no override configured sees exactly what they always did.
  const visibleItems = navItems.filter(
    (item) => (!item.roles || item.roles.includes(user?.roleName ?? '')) && canView(item.view)
  );

  const initials = user?.fullName
    ? user.fullName
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]!.toUpperCase())
        .join('')
    : '?';

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-white overflow-hidden flex-shrink-0">
            {company?.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- stored data URI, next/image's optimizer doesn't apply
              <img src={company.logoUrl} alt={`${company.name} logo`} className="h-full w-full object-cover" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- small static brand asset, no benefit from next/image here
              <img src="/brand/logo-icon.png" alt="Bizness-Ph-OS" className="h-full w-full object-contain" />
            )}
          </div>
          <div className="flex flex-col group-data-[collapsible=icon]:hidden">
            <span className="font-display text-[15px] font-semibold tracking-tight text-sidebar-foreground leading-none">
              {company?.name || 'Bizness-Ph-OS'}
            </span>
            <span className="text-[10px] text-sidebar-foreground/50 mt-1">
              {company?.name ? 'Bizness-Ph-OS' : 'Management System'}
            </span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/40 text-[10px] uppercase tracking-wider">
            Navigation
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleItems.map((item) => {
                const isActive = activeView === item.view;
                return (
                  <SidebarMenuItem key={item.view}>
                    <SidebarMenuButton
                      isActive={isActive}
                      onClick={() => setView(item.view)}
                      tooltip={item.label}
                      className={cn(
                        'cursor-pointer border-l-2 border-transparent text-sidebar-foreground/70 hover:text-sidebar-foreground',
                        isActive &&
                          'border-l-amber-400 bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                      )}
                    >
                      <item.icon className="h-4 w-4" />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-4 group-data-[collapsible=icon]:p-2">
        <div className="flex items-center gap-3 group-data-[collapsible=icon]:justify-center">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-500 text-brand-950 text-xs font-bold flex-shrink-0">
            {initials}
          </div>
          <div className="flex flex-col group-data-[collapsible=icon]:hidden">
            <span className="text-xs font-medium text-sidebar-foreground">{user?.fullName ?? 'Unknown user'}</span>
            <span className="text-[10px] text-sidebar-foreground/50">
              {user?.username ?? ''} {user?.roleName ? `· ${user.roleName}` : ''}
            </span>
          </div>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
