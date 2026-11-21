'use client';

import { Flower2, LayoutDashboard, Settings, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

export type NavIcon = 'dashboard' | 'catalog' | 'team' | 'settings';

export interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: NavIcon;
  /** true = attivo solo sulla corrispondenza esatta (es. la dashboard). */
  readonly exact?: boolean;
}

const ICONS = { dashboard: LayoutDashboard, catalog: Flower2, team: Users, settings: Settings };
const GRID_COLUMNS: Record<number, string> = { 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4' };

function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** Navigazione laterale (desktop). */
export function SidebarNav({ items, label }: { items: readonly NavItem[]; label: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="flex flex-col gap-1">
      {items.map((item) => {
        const Icon = ICONS[item.icon];
        const active = isActive(pathname, item);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              active
                ? 'bg-sidebar-accent text-foreground'
                : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-foreground',
            )}
          >
            <Icon className={cn('size-4', active ? 'text-primary' : 'text-muted-foreground')} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Barra di navigazione inferiore (mobile): raggiungibile con il pollice. */
export function BottomNav({ items, label }: { items: readonly NavItem[]; label: string }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label={label}
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <ul className={cn('mx-auto grid max-w-lg', GRID_COLUMNS[items.length] ?? 'grid-cols-4')}>
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const active = isActive(pathname, item);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex flex-col items-center gap-1 px-2 py-2.5 text-[11px] font-medium',
                  active ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                <Icon className="size-5" />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
