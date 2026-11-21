import Link from 'next/link';
import { Logo } from '@/components/brand/logo';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-[radial-gradient(ellipse_at_top,oklch(0.95_0.025_150),transparent_60%)]">
      <header className="mx-auto w-full max-w-md px-4 pt-8 pb-4">
        <Link href="/" className="inline-flex">
          <Logo />
        </Link>
      </header>
      <main className="mx-auto w-full max-w-md flex-1 px-4 pb-16">{children}</main>
    </div>
  );
}
