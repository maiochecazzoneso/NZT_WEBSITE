// src/components/ui/AnimationToggle.tsx
// Switch "Animazioni Interfaccia: Attive / Disattivate" (stile pnote.it, Specifica Contenuti §5.1) — architettura tecnica §2.2/§4, architettura grafica §7 (check 3).
// Agisce su animationsPausedStore: HeroPillScrollytelling passa a frameloop "demand", gsap-init.ts distrugge Lenis,
// completa i reveal e imposta <html class="animations-paused"> (pausa dei pulse CSS).
import { useEffect, useState } from 'react';
import { useStore } from '@nanostores/react';
import { Pause, Play } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { animationsPausedStore } from '@/lib/stores/uiStore';

export function AnimationToggle() {
  const storePaused = useStore(animationsPausedStore);
  // L'HTML statico è renderizzato con animazioni attive: finché l'isola non è montata mostriamo lo stesso
  // stato per evitare mismatch di idratazione (lo store può già valere true per prefers-reduced-motion).
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const isPaused = mounted && storePaused;
  const Icon = isPaused ? Play : Pause;

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      role="switch"
      aria-checked={!isPaused}
      className="-ml-3.5"
      onClick={() => animationsPausedStore.set(!animationsPausedStore.get())}
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.75} />
      Animazioni interfaccia:
      <span className="text-[#FAFAFA]">{isPaused ? 'Disattivate' : 'Attive'}</span>
    </Button>
  );
}
