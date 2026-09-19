'use client';

import * as React from 'react';
import { TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

/**
 * A curated, coordinated set of tile colors — used for visual variety and
 * scannability across a sub-menu's tiles. The *selected* tile is always
 * marked by the app's one accent color (amber, matching the sidebar's
 * active-item indicator) rather than by each tile changing color when
 * active — that keeps a consistent "this is selected" signal even while
 * individual tiles are colorful.
 */
export const TILE_COLORS = {
  brand: 'bg-brand-100 text-brand-700',
  amber: 'bg-amber-100 text-amber-700',
  sky: 'bg-sky-100 text-sky-700',
  rose: 'bg-rose-100 text-rose-700',
  violet: 'bg-violet-100 text-violet-700',
  teal: 'bg-teal-100 text-teal-700',
  orange: 'bg-orange-100 text-orange-700',
  slate: 'bg-slate-100 text-slate-700',
} as const;

export type TileColor = keyof typeof TILE_COLORS;

export function TileTabsList({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    // Sticky wrapper: matches the main app header's sticky/blur treatment
    // (top-14 = right below that 56px header) so a view's own sub-menu
    // stays reachable while scrolling through a long table below it,
    // instead of scrolling out of view along with the content.
    <div className="sticky top-14 z-20 -mx-4 md:-mx-6 px-4 md:px-6 pt-1 pb-3 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <TabsList
        className={cn(
          'h-auto w-full flex-wrap justify-start gap-3 bg-transparent p-0',
          className
        )}
      >
        {children}
      </TabsList>
    </div>
  );
}

export function TileTabsTrigger({
  value,
  icon: Icon,
  label,
  color,
}: {
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  color: TileColor;
}) {
  return (
    <TabsTrigger
      value={value}
      className={cn(
        'flex-none flex-col justify-center gap-2 h-24 w-28 rounded-xl border-2 border-border',
        'bg-card shadow-sm p-2',
        'data-[state=active]:border-amber-400 data-[state=active]:shadow-md data-[state=active]:bg-card',
        'hover:border-brand-300 transition-colors cursor-pointer'
      )}
    >
      <div
        className={cn(
          'flex h-10 w-10 items-center justify-center rounded-lg flex-shrink-0',
          TILE_COLORS[color]
        )}
      >
        <Icon className="h-5 w-5" />
      </div>
      <span className="text-[11px] font-medium text-foreground text-center leading-tight px-1">
        {label}
      </span>
    </TabsTrigger>
  );
}
