'use client';

import { Check, ChevronsUpDown, Plus, Store } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface ShopOption {
  readonly slug: string;
  readonly displayName: string;
}

export function TenantSwitcher({
  current,
  shops,
}: {
  current: ShopOption;
  shops: readonly ShopOption[];
}) {
  const t = useTranslations('nav');
  const tOnboarding = useTranslations('onboarding');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex w-full items-center gap-3 rounded-xl border bg-card px-3 py-2.5 text-left shadow-xs outline-none hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/40"
        aria-label={t('switchShop')}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
          <Store className="size-4" />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{current.displayName}</span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {t('yourShops')}
        </DropdownMenuLabel>
        {shops.map((shop) => (
          <DropdownMenuItem key={shop.slug} asChild>
            <Link href={`/app/${shop.slug}`}>
              <Store />
              <span className="flex-1 truncate">{shop.displayName}</span>
              {shop.slug === current.slug ? <Check className="text-primary" /> : null}
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/onboarding">
            <Plus />
            {tOnboarding('createAnother')}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
