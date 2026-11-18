export function LoadingScreen() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <p
        role="status"
        className="font-mono text-xs tracking-widest text-[var(--text-muted)] uppercase"
      >
        Caricamento…
      </p>
    </div>
  );
}
