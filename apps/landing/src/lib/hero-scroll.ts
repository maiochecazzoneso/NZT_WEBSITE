// src/lib/hero-scroll.ts
// Hero scrollytelling v3.0 (particle-to-text): timeline DOM (hint, bagliore, handoff headline, sottotitolo/CTA,
// navbar) separata dall'isola WebGL. Se three.js / WebGL / l'isola falliscono, l'headline e le CTA compaiono
// comunque legate allo scroll (senza particelle) e la navbar compare.
// Caricato da HeroSection.astro con import dinamico dopo load + idle: GSAP + ScrollTrigger (~46 KB gzip) sono lo
// stesso chunk già usato da gsap-init.ts e dall'isola, quindi un'unica istanza e nessun peso sul budget pre-idle.
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

// Classe su <html> che nasconde la navbar prima di questo modulo (MainLayout <head> + <style is:global> in HeroSection)
const NAV_GATE_CLASS = 'nav-gate';
// Finestra di comparsa della navbar sul progresso della Hero: a 0.92 il fly-out 3D (smoothstep 0.60 -> 0.95) è al
// 98 % e le particelle sono già dissolte (0.80 -> 0.93); a 1.00 le CTA hanno finito il reveal (0.76 + 0.22 = 0.98,
// più il ritardo dello scrub) e il box sticky inizia a scorrere via (arriva la TrustBar).
const NAV_REVEAL_START = 0.92;
// La navbar diventa cliccabile da metà della sua finestra (opacità ≈ 0.88 con power3.out)
const NAV_INTERACTIVE_AT = 0.5;

let initialized = false;

export function initHeroScroll(wrapper: HTMLElement): void {
  if (initialized) return;
  initialized = true;

  const stage2Container = document.getElementById('hero-stage-2');
  const stage2Headline = document.getElementById('hero-stage-2-headline');
  const stage2SubElements = gsap.utils.toArray<HTMLElement>('[data-particle-subreveal]');
  const coreGlowDom = document.getElementById('hero-core-glow');
  const scrollHint = document.getElementById('hero-scroll-hint');
  const header = document.getElementById('site-header');

  // Timeline legata allo scroll della Hero (spec v3.0 §3.1, durata totale 1.0 = progresso 0 -> 1)
  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: wrapper,
      start: 'top top',
      end: 'bottom bottom',
      scrub: 1.2,
    },
  });

  // 1. (0.00 -> 0.20) l'indicatore "Scroll to Open" si ingrandisce leggermente e sfuma via
  if (scrollHint) {
    tl.to(
      scrollHint,
      {
        scale: 1.06,
        opacity: 0,
        y: -24,
        ease: 'power2.inOut',
        duration: 0.2,
      },
      0,
    );
  }

  // 2. (0.18 -> 0.65 -> 1.00) bagliore radiale durante l'uscita dello sciame di particelle
  if (coreGlowDom) {
    tl.fromTo(
      coreGlowDom,
      { scale: 0.4, opacity: 0.15 },
      { scale: 1.75, opacity: 0.42, duration: 0.35, ease: 'power2.out' },
      0.18,
    ).to(coreGlowDom, { opacity: 0.16, scale: 1.2, duration: 0.35 }, 0.65);
  }

  // 3. (0.74 -> 0.90) handoff: l'headline HTML nitido compare esattamente sopra le lettere di particelle, che si
  // dissolvono nello shader (0.80 -> 0.93). Solo opacity/scale: nessun filter/blur animato (architettura grafica).
  if (stage2Headline && stage2Container) {
    tl.fromTo(
      stage2Headline,
      {
        opacity: 0,
        scale: 0.98,
      },
      {
        opacity: 1,
        scale: 1,
        duration: 0.16,
        ease: 'power2.out',
        onStart: () => {
          stage2Container.style.pointerEvents = 'auto';
        },
        onReverseComplete: () => {
          stage2Container.style.pointerEvents = 'none';
        },
      },
      0.74,
    );
  }

  // 4. (0.66 -> 0.98) badge, sottotitolo e CTA emergono con stagger
  if (stage2SubElements.length > 0) {
    tl.fromTo(
      stage2SubElements,
      {
        opacity: 0,
        y: 18,
        scale: 0.94,
      },
      {
        opacity: 1,
        y: 0,
        scale: 1,
        stagger: 0.05,
        duration: 0.22,
        ease: 'power3.out',
      },
      0.66,
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
