import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from '@/lib/utils';

const alertVariants = cva(
  'relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 rounded-xl border px-4 py-3 text-sm has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] has-[>svg]:gap-x-3 [&>svg]:size-4 [&>svg]:translate-y-0.5',
  {
    variants: {
      variant: {
        info: 'border-transparent bg-info-soft text-[oklch(0.35_0.07_245)]',
        success: 'border-transparent bg-success-soft text-[oklch(0.34_0.09_152)]',
        warning: 'border-transparent bg-warning-soft text-[oklch(0.38_0.09_65)]',
        destructive: 'border-transparent bg-danger-soft text-[oklch(0.42_0.16_27)]',
      },
    },
    defaultVariants: { variant: 'info' },
  },
);

export function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role={variant === 'destructive' ? 'alert' : 'status'}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

export function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="alert-title" className={cn('col-start-2 font-medium', className)} {...props} />
  );
}

export function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn('col-start-2 grid gap-1 text-sm opacity-90 [&_p]:leading-relaxed', className)}
      {...props}
    />
  );
}
