'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type * as React from 'react';
import { Input } from '@/components/ui/input';

export function PasswordInput(props: Omit<React.ComponentProps<'input'>, 'type'>) {
  const t = useTranslations('auth');
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={visible ? 'text' : 'password'} className="pr-11" />
      <button
        type="button"
        onClick={() => setVisible((value) => !value)}
        className="absolute top-1/2 right-1.5 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label={visible ? t('hidePassword') : t('showPassword')}
        aria-pressed={visible}
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}
