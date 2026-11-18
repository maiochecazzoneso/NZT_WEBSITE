/** Fascia sempre visibile: impedisce di confondere il pannello con l'Area Clienti. */
export function AdminBanner() {
  return (
    <div
      role="note"
      className="border-b border-white/30 bg-[var(--text-primary)] px-4 py-1.5 text-center font-mono text-xs font-semibold tracking-widest text-[#050505] uppercase"
    >
      Area amministratore · accesso riservato · non è l'Area Clienti
    </div>
  );
}
