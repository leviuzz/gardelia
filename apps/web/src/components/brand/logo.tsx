import { BRAND } from '@floral/domain';
import { cn } from '@/lib/utils';

/** Marchio: fiore stilizzato a cinque petali + nome prodotto (nome di lavoro). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn('size-8', className)}>
      <rect width="32" height="32" rx="9" className="fill-primary" />
      <g className="fill-primary-foreground" opacity="0.95">
        {[0, 72, 144, 216, 288].map((angle) => (
          <ellipse
            key={angle}
            cx="16"
            cy="10.2"
            rx="3.4"
            ry="5.2"
            transform={`rotate(${angle} 16 16)`}
          />
        ))}
      </g>
      <circle cx="16" cy="16" r="2.6" className="fill-[oklch(0.85_0.09_85)]" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark />
      <span className="font-display text-lg font-semibold tracking-tight">{BRAND.productName}</span>
    </span>
  );
}
