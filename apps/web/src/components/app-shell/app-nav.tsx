'use client';

import {
  Contact,
  Ellipsis,
  FileText,
  Flower2,
  LayoutDashboard,
  Settings,
  Sparkles,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export type NavIcon =
  'dashboard' | 'quotes' | 'builder' | 'customers' | 'catalog' | 'team' | 'settings';

export interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: NavIcon;
  /** true = attivo solo sulla corrispondenza esatta (es. la dashboard). */
  readonly exact?: boolean;
  /** Voce d'uso occasionale: su mobile va nel menu "Más". */
  readonly secondary?: boolean;
  /** Sotto-percorsi che appartengono a un'altra voce (es. /settings/team). */
  readonly exclude?: readonly string[];
}

const ICONS = {
  dashboard: LayoutDashboard,
  quotes: FileText,
  builder: Sparkles,
  customers: Contact,
  catalog: Flower2,
  team: Users,
  settings: Settings,
};
const GRID_COLUMNS: Record<number, string> = {
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
  5: 'grid-cols-5',
};

function matches(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  if (item.exclude?.some((href) => matches(pathname, href))) return false;
  return matches(pathname, item.href);
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

const bottomItemClass =
  'flex w-full min-w-0 flex-col items-center gap-1 px-0.5 py-2.5 text-[10px] font-medium outline-none focus-visible:bg-muted/60 min-[400px]:text-[11px]';

/**
 * Barra di navigazione inferiore (mobile): raggiungibile con il pollice. Le voci
 * principali restano visibili; quelle secondarie (team, impostazioni) vanno in "Más".
 */
export function BottomNav({
  items,
  label,
  moreLabel,
}: {
  items: readonly NavItem[];
  label: string;
  moreLabel: string;
}) {
  const pathname = usePathname();
  const primary = items.filter((item) => !item.secondary);
  const secondary = items.filter((item) => item.secondary);
  const columns = primary.length + (secondary.length > 0 ? 1 : 0);
  const secondaryActive = secondary.some((item) => isActive(pathname, item));

  return (
    <nav
      aria-label={label}
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden print:hidden"
    >
      <ul className={cn('mx-auto grid max-w-lg', GRID_COLUMNS[columns] ?? 'grid-cols-5')}>
        {primary.map((item) => {
          const Icon = ICONS[item.icon];
          const active = isActive(pathname, item);
          return (
            <li key={item.href} className="min-w-0">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(bottomItemClass, active ? 'text-primary' : 'text-muted-foreground')}
              >
                <Icon className="size-5" aria-hidden="true" />
                <span className="max-w-full truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
        {secondary.length > 0 ? (
          <li className="min-w-0">
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  bottomItemClass,
                  secondaryActive ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                <Ellipsis className="size-5" aria-hidden="true" />
                <span className="max-w-full truncate">{moreLabel}</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="top" className="w-56">
                {secondary.map((item) => {
                  const Icon = ICONS[item.icon];
                  const active = isActive(pathname, item);
                  return (
                    <DropdownMenuItem key={item.href} asChild>
                      <Link
                        href={item.href}
                        aria-current={active ? 'page' : undefined}
                        className={cn(active && 'font-medium text-primary')}
                      >
                        <Icon />
                        {item.label}
                      </Link>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}
