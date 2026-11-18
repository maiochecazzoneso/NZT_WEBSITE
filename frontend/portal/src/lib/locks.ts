// Mutua esclusione tra schede tramite Web Locks API (spec §6.4). Se l'API non esiste (browser molto
// vecchi) si ripiega su un mutex limitato alla scheda corrente: documentato come rischio residuo.

export type LockRunner = <T>(name: string, task: () => Promise<T>) => Promise<T>;

const localQueues = new Map<string, Promise<unknown>>();

function localLock<T>(name: string, task: () => Promise<T>): Promise<T> {
  const previous = localQueues.get(name) ?? Promise.resolve();
  const run = previous.then(task, task);
  localQueues.set(
    name,
    run.catch(() => undefined),
  );
  return run;
}

export const withLock: LockRunner = (name, task) => {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (locks && typeof locks.request === 'function') {
    return locks.request(name, { mode: 'exclusive' }, () => task()) as Promise<
      Awaited<ReturnType<typeof task>>
    >;
  }
  return localLock(name, task);
};
