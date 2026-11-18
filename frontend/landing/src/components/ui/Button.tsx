// src/components/ui/Button.tsx
import React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 disabled:pointer-events-none disabled:opacity-40 cursor-pointer',
  {
    variants: {
      variant: {
        primary:
          'bg-[#FAFAFA] text-[#050505] hover:bg-zinc-200 hover:-translate-y-0.5 shadow-[0_0_25px_rgba(255,255,255,0.12)]',
        secondary:
          'bg-[#16161A] text-[#FAFAFA] border border-[var(--border-subtle)] hover:border-[var(--border-hover)] hover:bg-zinc-800/80',
        ghost: 'bg-transparent text-[#A1A1AA] hover:text-[#FAFAFA] hover:bg-white/[0.04]',
      },
      size: {
        sm: 'h-9 px-3.5 text-xs',
        md: 'h-11 px-5 text-sm',
        lg: 'h-12 px-7 text-sm',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}
