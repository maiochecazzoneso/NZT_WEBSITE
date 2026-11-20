import { useCallback, useEffect, useRef, useState } from 'react';

export interface Resource<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  /** Ricarica. `silent` = senza mostrare lo stato di caricamento (polling). */
  reload: (options?: { silent?: boolean }) => Promise<void>;
  setData: (data: T) => void;
}

/** Carica una risorsa all'avvio e quando cambia `load`; scarta le risposte superate. */
export function useResource<T>(load: () => Promise<T>): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const sequence = useRef(0);

  const run = useCallback(
    async (options?: { silent?: boolean }) => {
      sequence.current += 1;
      const mine = sequence.current;
      if (!options?.silent) setLoading(true);
      try {
        const result = await load();
        if (mine !== sequence.current) return;
        setData(result);
        setError(null);
      } catch (caught) {
        if (mine !== sequence.current) return;
        setError(caught);
      } finally {
        if (mine === sequence.current) setLoading(false);
      }
    },
    [load],
  );

  useEffect(() => {
    void run();
    return () => {
      sequence.current += 1;
    };
  }, [run]);

  return { data, error, loading, reload: run, setData };
}
