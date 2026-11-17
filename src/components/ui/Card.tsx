// src/components/ui/Card.tsx
import React, { useRef } from 'react';
import { cn } from '@/lib/utils';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  spotlight?: boolean;
}

export function Card({ className, spotlight = true, children, ...props }: CardProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!spotlight || !cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    cardRef.current.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
    cardRef.current.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
  };

  return (
    <div
      ref={cardRef}
      onPointerMove={handlePointerMove}
      className={cn(
        'rounded-2xl p-6 sm:p-8',
        spotlight ? 'specular-card' : 'border border-[var(--border-subtle)] bg-[var(--bg-surface)]',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
