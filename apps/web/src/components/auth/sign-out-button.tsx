'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth-client';

export function SignOutButton({ label, redirectTo }: { label: string; redirectTo: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      className="w-full"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await authClient.signOut();
          router.replace(redirectTo);
          router.refresh();
        })
      }
    >
      {label}
    </Button>
  );
}
