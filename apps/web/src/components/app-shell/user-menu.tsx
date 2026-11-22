'use client';

import { Check, LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { ENABLED_LOCALES, LOCALE_NAMES, type SupportedLocale } from '@floral/domain';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { changeLocaleAction } from '@/i18n/actions';
import { authClient } from '@/lib/auth-client';
import { initials } from '@/lib/format';
import { cn } from '@/lib/utils';

export function UserMenu({
  name,
  email,
  roleLabel,
  compact = false,
}: {
  name: string;
  email: string;
  roleLabel: string;
  compact?: boolean;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Lingua dell'interfaccia di questo browser (ADR-042): l'azione salva il cookie e ricarica.
  const changeLocale = (code: SupportedLocale) =>
    startTransition(async () => {
      const form = new FormData();
      form.set('locale', code);
      await changeLocaleAction(form);
      router.refresh();
    });

  const signOut = () =>
    startTransition(async () => {
      await authClient.signOut();
      router.replace('/login');
      router.refresh();
    });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'flex items-center gap-3 rounded-xl text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
          compact ? 'p-1' : 'w-full p-2 hover:bg-sidebar-accent/60',
        )}
        aria-label={t('nav.account')}
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground">
          {initials(name)}
        </span>
        {compact ? null : (
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{name}</span>
            <span className="block truncate text-xs text-muted-foreground">{roleLabel}</span>
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={compact ? 'end' : 'start'} className="w-60">
        <DropdownMenuLabel>
          <span className="block truncate font-medium">{name}</span>
          <span className="block truncate text-xs text-muted-foreground">{email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            {t('common.language')}
          </DropdownMenuLabel>
          {ENABLED_LOCALES.map((code) => (
            <DropdownMenuItem
              key={code}
              lang={code}
              disabled={pending}
              aria-current={code === locale ? 'true' : undefined}
              onSelect={() => {
                if (code !== locale) changeLocale(code);
              }}
            >
              <Check className={code === locale ? undefined : 'invisible'} aria-hidden="true" />
              {LOCALE_NAMES[code]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut} disabled={pending}>
          <LogOut />
          {t('auth.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
