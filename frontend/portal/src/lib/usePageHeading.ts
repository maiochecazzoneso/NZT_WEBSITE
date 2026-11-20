import { useEffect, useRef } from 'react';
import { hasNavigated } from './router';

/** Titolo del documento + focus sull'<h1> dopo una navigazione SPA (annuncio per screen reader). */
export function usePageHeading(title: string) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    document.title = `${title} · Area Clienti · NZT Solutions`;
    if (hasNavigated()) ref.current?.focus();
  }, [title]);
  return ref;
}
