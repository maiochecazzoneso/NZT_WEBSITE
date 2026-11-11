// src/components/interactive/HeroInteractiveMockup.tsx
// "Control Room" NZT Solutions (Specifica Contenuti §3 Sezione 1): 3 moduli che simulano ciò che l'azienda
// costruisce per i clienti. Un unico tick (1.4 s) anima i tre pannelli; si ferma fuori viewport, con
// AnimationToggle in pausa o con prefers-reduced-motion (in quei casi i pannelli mostrano lo stato completo).
// I valori mostrati sono un flusso d'esempio, dichiarato come tale nell'interfaccia.
import { useEffect, useRef, useState } from 'react';
import { useStore } from '@nanostores/react';
import { animationsPausedStore } from '@/lib/stores/uiStore';
import { cn } from '@/lib/utils';

const TICK_MS = 1400;

const FLOW_STEPS = [
  { label: 'Ingresso ordine / documento', detail: 'ordine_4821.pdf · da email' },
  { label: 'Estrazione dati AI', detail: '14 campi letti · cliente, righe, importi' },
  { label: 'Verifica regole di business', detail: 'listino, fido, disponibilità: ok' },
  { label: 'Aggiornamento ERP & notifica', detail: 'commessa creata · magazzino avvisato' },
];

const ARCH_NODES = [
  'Interfaccia web dedicata',
  'API gateway proprietarie',
  'Database aziendale isolato',
];

const AI_QUESTION = 'Quali contratti fornitori scadono entro marzo con rinnovo tacito?';
const AI_ANSWER = '3 contratti: Logistica Nord, Manutenzioni Impianti, Software Paghe.';
const AI_SOURCES = [
  'contratti/2023/logistica_nord.pdf · p. 4',
  'contratti/2024/manutenzioni.pdf · p. 2',
];

function Panel({
  index,
  title,
  children,
}: {
  index: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <article className="specular-card flex flex-col overflow-hidden rounded-2xl">
      <header className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-5 py-3">
        <h3 className="font-mono text-[11px] tracking-widest text-[#FAFAFA] uppercase">{title}</h3>
        <span className="font-mono text-[11px] text-[var(--text-subtle)]">
          {String(index).padStart(2, '0')}
        </span>
      </header>
      <div className="bg-technical-grid flex flex-1 flex-col p-5">{children}</div>
    </article>
  );
}

export function HeroInteractiveMockup() {
  const paused = useStore(animationsPausedStore);
  const rootRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setReducedMotion(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const node = rootRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      threshold: 0.15,
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const running = visible && !paused && !reducedMotion;

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => window.clearInterval(id);
  }, [running]);

  // Ferme (pausa, reduced motion, fuori viewport o senza JS): ogni pannello mostra lo stato finale, leggibile
  // per intero. È anche lo stato renderizzato in build (HTML statico).
  const still = !running;

  // Modulo 1: 4 passaggi + 1 tick di esito + 1 tick di pausa
  const flowCycle = FLOW_STEPS.length + 2;
  const flowStep = still ? FLOW_STEPS.length : tick % flowCycle;
  const flowDone = flowStep >= FLOW_STEPS.length;

  // Modulo 2: il pacchetto viaggia avanti e indietro tra i tre nodi (0 1 2 1)
  const archPath = [0, 1, 2, 1];
  const archActive = still ? -1 : archPath[tick % archPath.length];

  // Modulo 3: domanda → elaborazione → risposta con fonti
  const aiPhase = still ? 2 : tick % 5 < 1 ? 0 : tick % 5 < 2 ? 1 : 2;

  return (
    <div ref={rootRef} className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {/* MODULO 1 — Flusso aziendale automatizzato */}
      <Panel index={1} title="Flusso aziendale automatizzato">
        <ol className="space-y-2.5">
          {FLOW_STEPS.map((step, i) => {
            const state = i < flowStep ? 'done' : i === flowStep ? 'active' : 'idle';
            return (
              <li
                key={step.label}
                className={cn(
                  'rounded-lg border px-3 py-2 transition-colors duration-500',
                  state === 'active'
                    ? 'border-white/30 bg-white/[0.06]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-primary)]/60',
                )}
              >
                <p className="flex items-center gap-2 text-xs font-medium text-[#FAFAFA]">
                  <span
                    aria-hidden="true"
                    className={cn(
                      'h-1.5 w-1.5 shrink-0 rounded-full transition-colors duration-500',
                      state === 'idle' ? 'bg-zinc-700' : 'bg-white',
                      state === 'active' && 'animate-pulse',
                    )}
                  />
                  {step.label}
                </p>
                <p
                  className={cn(
                    'mt-1 pl-3.5 font-mono text-[11px] transition-opacity duration-500',
                    state === 'idle' ? 'opacity-30' : 'opacity-100',
                    'text-[var(--text-muted)]',
                  )}
                >
                  {step.detail}
                </p>
              </li>
            );
          })}
        </ol>
        <p
          className={cn(
            'mt-4 flex items-center justify-between border-t border-[var(--border-subtle)] pt-3 font-mono text-[11px] tracking-widest uppercase transition-colors duration-500',
            flowDone ? 'text-[#FAFAFA]' : 'text-[var(--text-subtle)]',
          )}
        >
          <span>Ricopiature manuali</span>
          <span>0</span>
        </p>
      </Panel>

      {/* MODULO 2 — Architettura software custom */}
      <Panel index={2} title="Architettura software custom">
        <div className="flex flex-1 flex-col justify-center">
          {ARCH_NODES.map((node, i) => (
            <div key={node}>
              {i > 0 && (
                <div aria-hidden="true" className="flex h-8 justify-center">
                  <span className="relative w-px bg-white/15">
                    <span
                      className={cn(
                        'absolute left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.8)] transition-[top,opacity] duration-700 ease-out-expo',
                        archActive === i ? 'opacity-100' : 'opacity-0',
                        archActive === i ? 'top-[calc(100%-0.5rem)]' : 'top-0',
                      )}
                    />
                  </span>
                </div>
              )}
              <div
                className={cn(
                  'rounded-lg border px-3 py-2.5 text-center text-xs font-medium transition-colors duration-500',
                  archActive === i
                    ? 'border-white/30 bg-white/[0.06] text-[#FAFAFA]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-primary)]/60 text-[var(--text-muted)]',
                )}
              >
                {node}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-4 flex items-center justify-between border-t border-[var(--border-subtle)] pt-3 font-mono text-[11px] tracking-widest text-[#FAFAFA] uppercase">
          <span>Latenza obiettivo</span>
          <span>&lt; 40 ms</span>
        </p>
      </Panel>

      {/* MODULO 3 — Intelligenza Artificiale privata */}
      <Panel index={3} title="Intelligenza Artificiale privata">
        <div className="flex flex-1 flex-col gap-3">
          <div className="ml-auto max-w-[90%] rounded-lg rounded-br-sm border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] px-3 py-2 text-xs leading-relaxed text-[#FAFAFA]">
            {AI_QUESTION}
          </div>
          <div className="min-h-[7.5rem] max-w-[95%] rounded-lg rounded-bl-sm border border-[var(--border-subtle)] bg-[var(--bg-primary)]/60 px-3 py-2 text-xs leading-relaxed text-[var(--text-muted)]">
            {aiPhase === 0 && (
              <span className="font-mono text-[11px]">In attesa della domanda…</span>
            )}
            {aiPhase === 1 && (
              <span className="font-mono text-[11px]">Ricerca nell’archivio interno…</span>
            )}
            {aiPhase === 2 && (
              <>
                <p className="text-[#FAFAFA]">{AI_ANSWER}</p>
                <ul className="mt-2 space-y-1 font-mono text-[10.5px]">
                  {AI_SOURCES.map((source) => (
                    <li key={source}>↳ {source}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
        <p className="mt-4 border-t border-[var(--border-subtle)] pt-3 text-xs leading-relaxed text-[var(--text-muted)]">
          Modelli AI interrogabili dai dipendenti sui dati interni, senza dispersione di
          informazioni su cloud pubblici.
        </p>
      </Panel>
    </div>
  );
}
