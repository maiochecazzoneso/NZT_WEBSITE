// src/components/ui/Badge.tsx
import React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-2.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-1.5 font-mono text-xs uppercase tracking-widest',
  {
    variants: {
      variant: {
        muted: 'text-[var(--text-muted)]',
        primary: 'text-[var(--text-primary)]',
      },
    },
    defaultVariants: {
      variant: 'muted',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {
  dot?: boolean;
}

export function Badge({ className, variant, dot = false, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant, className }))} {...props}>
      {dot && (
        <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
      )}
      {children}
    </span>
  );
}
