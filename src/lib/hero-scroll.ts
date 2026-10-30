// src/lib/hero-scroll.ts
// Hero scrollytelling v2.1: timeline DOM (bagliore, testi stage-2, "Scroll to Open", navbar) separata dall'isola
// WebGL. Se three.js / WebGL / l'isola falliscono, i testi escono comunque "dalla pillola" e la navbar compare.
// Caricato da HeroSection.astro con import dinamico dopo load + idle: GSAP + ScrollTrigger (~46 KB gzip) sono lo
// stesso chunk già usato da gsap-init.ts e dall'isola, quindi un'unica istanza e nessun peso sul budget pre-idle.
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

// Classe su <html> che nasconde la navbar prima di questo modulo (MainLayout <head> + <style is:global> in HeroSection)
const NAV_GATE_CLASS = 'nav-gate';
// Finestra di comparsa della navbar sul progresso della Hero: da 0.92 le due metà della pillola sono già fuori
// inquadratura, a 1.00 il fly-out 3D è concluso e il box sticky inizia a scorrere via (arriva la TrustBar).
const NAV_REVEAL_START = 0.92;
// La navbar diventa cliccabile da metà della sua finestra (opacità ≈ 0.88 con power3.out)
const NAV_INTERACTIVE_AT = 0.5;

let initialized = false;

export function initHeroScroll(wrapper: HTMLElement): void {
  if (initialized) return;
  initialized = true;

  const stage2Text = document.getElementById('hero-stage-2');
  const coreGlowDom = document.getElementById('hero-core-glow');
  const scrollHint = document.getElementById('hero-scroll-hint');
  const header = document.getElementById('site-header');

  // Timeline legata allo scroll della Hero: stessi trigger, scrub e posizioni della v2.0 (durata totale 1.0)
  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: wrapper,
      start: 'top top',
      end: 'bottom bottom',
      scrub: 1.2,
    },
  });

  // Fase 1 (0.00 -> 0.28): l'indicatore "Scroll to Open" si ingrandisce leggermente e sfuma via
  if (scrollHint) {
    tl.to(
      scrollHint,
      {
        scale: 1.08,
        opacity: 0,
        y: -30,
        ease: 'power2.inOut',
        duration: 0.28,
      },
      0,
    );
  }

  // Bagliore radiale bianco che si espande all'apertura della pillola
  if (coreGlowDom) {
    tl.fromTo(
      coreGlowDom,
      { scale: 0.5, opacity: 0.15 },
      { scale: 1.6, opacity: 0.45, duration: 0.45, ease: 'power2.out' },
      0.2,
    ).to(coreGlowDom, { opacity: 0.15, scale: 1.2, duration: 0.35 }, 0.65);
  }

  // Fase 2 (0.30 -> 0.72): i testi + CTA emergono dal cuore della pillola aperta
  if (stage2Text) {
    tl.fromTo(
      stage2Text,
      {
        scale: 0.78,
        opacity: 0,
        y: 24,
      },
      {
        scale: 1,
        opacity: 1,
        y: 0,
        ease: 'power3.out',
        duration: 0.42,
        onStart: () => {
          stage2Text.style.pointerEvents = 'auto';
        },
        onReverseComplete: () => {
          stage2Text.style.pointerEvents = 'none';
        },
      },
      0.3,
    );
  }

  // Navbar: compare a fine animazione (0.92 -> 1.00) e si nasconde tornando nella Hero. Tween separato con
  // scrub: true (nessun ritardo): stato sempre coerente con lo scroll, anche ricaricando sotto la Hero o su #ancora.
  if (header) {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const syncInteractivity = (progress: number) => {
      header.style.pointerEvents = progress >= NAV_INTERACTIVE_AT ? '' : 'none';
    };
    const navTween = gsap.fromTo(
      header,
      { autoAlpha: 0, y: reduceMotion ? 0 : -16 },
      {
        autoAlpha: 1,
        y: 0,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: wrapper,
          start: () =>
            `top+=${Math.round(NAV_REVEAL_START * (wrapper.offsetHeight - window.innerHeight))} top`,
          end: 'bottom bottom',
          scrub: true,
          onUpdate: (self) => syncInteractivity(self.progress),
        },
      },
    );
    // Il tween (non una timeline) calcola la posizione in modo sincrono: lo stato iniziale è già quello giusto
    syncInteractivity(navTween.scrollTrigger?.progress ?? 0);
  }

  // Da qui la navbar è governata dagli stili inline di GSAP: il gate CSS non serve più
  document.documentElement.classList.remove(NAV_GATE_CLASS);
}
