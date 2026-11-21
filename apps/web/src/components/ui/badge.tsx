import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap [&>svg]:size-3',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'text-foreground',
        success: 'border-transparent bg-success-soft text-[oklch(0.38_0.1_152)]',
        warning: 'border-transparent bg-warning-soft text-[oklch(0.42_0.1_65)]',
        danger: 'border-transparent bg-danger-soft text-[oklch(0.45_0.17_27)]',
        info: 'border-transparent bg-info-soft text-[oklch(0.4_0.09_245)]',
        muted: 'border-transparent bg-muted text-muted-foreground',
        accent: 'border-transparent bg-accent text-accent-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>['variant']>;

export function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}
