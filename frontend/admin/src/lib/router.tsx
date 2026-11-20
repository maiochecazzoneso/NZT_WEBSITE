// Router minimo (History API) per 5 rotte: nessuna dipendenza esterna. Gestisce link interni,
// back/forward, redirect e lo spostamento del focus sul titolo della pagina dopo una navigazione.

import { useEffect, useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';

const listeners = new Set<() => void>();
let navigations = 0;

function emit(): void {
  for (const listener of listeners) listener();
}

function onPopState(): void {
  navigations += 1;
  emit();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener('popstate', onPopState);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('popstate', onPopState);
  };
}

export function normalizePath(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') || '/' : '/';
}

export function navigate(to: string, { replace = false }: { replace?: boolean } = {}): void {
  navigations += 1;
  if (replace) window.history.replaceState(null, '', to);
  else window.history.pushState(null, '', to);
  emit();
}

/** true dopo almeno una navigazione interna: al primo caricamento il focus resta al browser. */
export function hasNavigated(): boolean {
  return navigations > 0;
}

export function usePathname(): string {
  return useSyncExternalStore(subscribe, () => normalizePath(window.location.pathname));
}

export interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to: string;
}

export function Link({ to, onClick, ...props }: LinkProps) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={handleClick} {...props} />;
}

export function Redirect({ to }: { to: string }) {
  useEffect(() => {
    navigate(to, { replace: true });
  }, [to]);
  return null;
}
