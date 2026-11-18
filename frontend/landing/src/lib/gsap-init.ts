// src/lib/gsap-init.ts
// Setup centrale di GSAP ScrollTrigger + Lenis (architettura tecnica §6.1). Delta rispetto al documento:
// - fade-up y 24px → 0, 0.75 s, power3.out (architettura grafica §5.1, prevale);
// - Lenis disattivato su touch (pointer: coarse) e con prefers-reduced-motion (architettura tecnica §2.2);
// - pausa utente: Lenis distrutto (lenis.stop() in lenis 1.3 blocca anche la rotella del mouse) e reveal
//   completati subito (gsap.globalTimeline.pause() lascerebbe invisibili gli elementi non ancora rivelati);
// - stato di pausa riflesso su <html class="animations-paused"> per le animazioni CSS (pulse);
// - numerazione MethodSection illuminata con ScrollTrigger toggleClass (architettura grafica §5.2.5).
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { animationsPausedStore } from './stores/uiStore';

gsap.registerPlugin(ScrollTrigger);

const PAUSED_CLASS = 'animations-paused';

let initialized = false;
let lenis: Lenis | null = null;
let revealTweens: gsap.core.Tween[] = [];

function startLenis(): void {
  // Nessuno smooth scroll sui dispositivi touch: scroll nativo
  if (lenis || window.matchMedia('(pointer: coarse)').matches) return;
  lenis = new Lenis({
    duration: 1.1,
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    smoothWheel: true,
    // Click sulle ancore (#sistemi, #contatti…) gestiti da Lenis
    anchors: true,
  });
  lenis.on('scroll', ScrollTrigger.update);
}

function stopLenis(): void {
  lenis?.destroy();
  lenis = null;
}

function initReveals(): void {
  const revealLine = window.innerHeight * 0.85;
  gsap.utils.toArray<HTMLElement>('[data-animate="fade-up"]').forEach((el) => {
    // Gli elementi già nella zona visibile all'avvio restano visibili (nessun flash del contenuto)
    if (el.getBoundingClientRect().top < revealLine) return;
    revealTweens.push(
      gsap.fromTo(
        el,
        { y: 24, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.75,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: el,
            start: 'top 85%',
            toggleActions: 'play none none none',
          },
        },
      ),
    );
  });
}

function revealAllNow(): void {
  revealTweens.forEach((tween) => {
    tween.scrollTrigger?.kill();
    tween.kill();
    gsap.set(tween.targets(), { clearProps: 'opacity,transform' });
  });
  revealTweens = [];
}

function initMethodHighlight(): void {
  gsap.utils.toArray<HTMLElement>('[data-method-step]').forEach((step) => {
    ScrollTrigger.create({
      trigger: step,
      start: 'top 65%',
      end: 'bottom 35%',
      toggleClass: 'is-active',
    });
  });
}

export function initSmoothScrollAndAnimations(): void {
  if (initialized) return;
  initialized = true;

  // Pausa globale → classe su <html> (CSS: animation-play-state: paused)
  animationsPausedStore.subscribe((isPaused) => {
    document.documentElement.classList.toggle(PAUSED_CLASS, isPaused);
  });

  // Solo cambio colore, nessun movimento: attivo anche con prefers-reduced-motion
  initMethodHighlight();

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReducedMotion) {
    animationsPausedStore.set(true);
    return;
  }

  // Lenis sincronizzato con il ticker di GSAP (no-op finché Lenis non è attivo)
  gsap.ticker.add((time) => {
    lenis?.raf(time * 1000);
  });
  gsap.ticker.lagSmoothing(0);

  initReveals();

  // Toggle "Pausa/Attiva Animazioni" (subscribe viene invocato subito con il valore corrente)
  animationsPausedStore.subscribe((isPaused) => {
    if (isPaused) {
      stopLenis();
      revealAllNow();
    } else {
      startLenis();
    }
  });
}
