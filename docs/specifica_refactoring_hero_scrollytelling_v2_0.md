# NZT Solutions — Refactoring Hero Section: Scrollytelling 3D (v2.0)

> **Obiettivo per l'AI Assistant (Claude):** Sostituire l'attuale `HeroSection.astro` a due colonne (testo a sinistra + pillola 3D a destra) con una **Hero Section Scrollytelling a tutto schermo in stile Awwwards**.  
> **Cosa NON toccare:** Mantieni invariati la palette monocromatica (`global.css`), la configurazione di Lenis/GSAP, `uiStore.ts` e tutte le sezioni successive del sito (`TrustBar`, `ServicesSection`, ecc.).

---

## 1. Nuova Visione della Hero Section (Cosa deve succedere)

Abbandoniamo la divisione classica sinistra/destra. L'ingresso nel sito deve essere un'esperienza cinematografica centrata su uno spazio di scorrimento di **`320vh`** con un contenitore `sticky top-0 h-screen w-full overflow-hidden`:

1. **Stato Iniziale (`0%` Scroll):** Al centro dello schermo nero (`#050505`) fluttua la **Pillola 3D NZT** chiusa, in grande formato. La pillola reagisce in modo fluido e pesante al movimento del mouse (inclinazione smorzata + spostamento dei riflessi speculari bianchi) e si socchiude leggermente se l'utente ci passa sopra col cursore (*hover*). In sovrimpressione c'è l'`<h1>` principale.
2. **Inizio Scroll (`0% -> 25%`):** Appena l'utente inizia a scrollare, il titolo iniziale sfuma via con un leggero *scale-up*, mentre la pillola 3D si allinea al centro esatto dello schermo su un asse diagonale/orizzontale.
3. **Apertura della Pillola & Rivelazione Testi (`25% -> 75%`):** Continuando a scrollare, le due metà della pillola (vetro fumé superiore e ossidiana opaca inferiore) **si aprono separandosi lungo il loro asse**. Dal nucleo interno luminoso della pillola "escono" i testi del payoff e della value proposition (che emergono dal centro tra le due metà aperte con una transizione fluida di `scale` da `0.82` a `1.0` e `opacity` da `0` a `1`).
4. **Uscita della Pillola & Comparsa del Sito (`75% -> 100%`):** Negli ultimi centimetri di scroll della Hero, le due metà della pillola scivolano fuori campo verso i bordi esterni dello schermo (effetto *fly-through* della camera che passa in mezzo alla capsula aperta) e sfumano. Al centro restano i testi rivelati con i bottoni CTA cliccabili, dopodiché il blocco `sticky` si sblocca e sale normalmente il resto del sito.

---

## 2. Architettura Tecnica del Refactoring (Zero Penalizzazione SEO)

Per evitare che questa animazione pesi su Google PageSpeed ($98-100/100$) o nasconda i testi ai crawler SEO:

* **Tutti i testi sono nel DOM HTML di Astro (`HeroSection.astro`):** Non inserire mai testi dentro il Canvas 3D. Sia l'`<h1>` iniziale sia i testi che "escono" dalla pillola (`stage-2`) sono normali tag HTML posizionati in `absolute` al centro del viewport (`z-20`) sopra il Canvas WebGL (`z-10`).
* **Sincronizzazione Unica tramite Variabile di Scroll:** Il componente `HeroPillScrollytelling.tsx` usa GSAP `ScrollTrigger` (`scrub: 1.2`) agganciato a `#hero-scrolly-wrapper` per animare i nodi DOM e, contemporaneamente, aggiorna un `scrollProgressRef.current` (valore da `0` a `1`) letto dal loop `useFrame` di Three.js.
* **Spegnimento Automatico GPU:** Appena l'utente supera i `320vh` della Hero e passa al resto del sito, un `IntersectionObserver` imposta il Canvas WebGL su `frameloop="demand"`, portando a **0%** il carico sulla scheda video.

---

## 3. Codice da Sostituire / Aggiornare

### 3.1 Nuovo Componente 3D: `src/components/interactive/HeroPillScrollytelling.tsx`
*(Sostituisce il precedente `HeroPill3D.tsx` o `HeroInteractiveMockup.tsx`)*

```tsx
// src/components/interactive/HeroPillScrollytelling.tsx
import React, { useRef, useState, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment, ContactShadows } from '@react-three/drei';
import * as THREE from 'three';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useStore } from '@nanostores/react';
import { animationsPausedStore } from '@/lib/stores/uiStore';

gsap.registerPlugin(ScrollTrigger);

interface SceneProps {
  isPaused: boolean;
  mouseNorm: React.MutableRefObject<{ x: number; y: number }>;
  scrollProgress: React.MutableRefObject<number>;
}

function ScrollyPillMesh({ isPaused, mouseNorm, scrollProgress }: SceneProps) {
  const rootGroupRef = useRef<THREE.Group>(null);
  const topHalfRef = useRef<THREE.Group>(null);
  const bottomHalfRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const coreMeshRef = useRef<THREE.Mesh>(null);
  const coreMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const rimLightRef = useRef<THREE.PointLight>(null);

  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    document.body.style.cursor = hovered ? 'pointer' : 'auto';
    return () => {
      document.body.style.cursor = 'auto';
    };
  }, [hovered]);

  useFrame((state, delta) => {
    if (isPaused || !rootGroupRef.current) return;

    const dt = Math.min(delta, 0.1);
    const t = state.clock.getElapsedTime();
    const p = scrollProgress.current; // Progresso scroll da 0.0 a 1.0

    // Fattore di smorzamento esponenziale (movimento fluido e pesante)
    const damp = 1 - Math.exp(-3.5 * dt);
    const fastDamp = 1 - Math.exp(-6.0 * dt);

    // 1. CALCOLO APERTURA PILLOLA IN BASE ALLO SCROLL + HOVER
    // Da p=0.20 a p=0.75 la pillola si apre; da p=0.75 a p=1.00 le due metà escono di scena
    const scrollOpenProgress = THREE.MathUtils.smoothstep(p, 0.18, 0.72);
    const flyOutProgress = THREE.MathUtils.smoothstep(p, 0.72, 1.0);
    const hoverMicroOpen = hovered && p < 0.2 ? 0.08 : 0.0;

    const totalSeparation =
      hoverMicroOpen + scrollOpenProgress * 1.85 + flyOutProgress * 3.8;

    if (topHalfRef.current && bottomHalfRef.current) {
      topHalfRef.current.position.y = THREE.MathUtils.lerp(
        topHalfRef.current.position.y,
        totalSeparation,
        fastDamp
      );
      bottomHalfRef.current.position.y = THREE.MathUtils.lerp(
        bottomHalfRef.current.position.y,
        -totalSeparation,
        fastDamp
      );

      // Leggera rotazione opposta delle due calotte mentre si aprono
      topHalfRef.current.rotation.y = scrollOpenProgress * 0.6;
      bottomHalfRef.current.rotation.y = -scrollOpenProgress * 0.6;
    }

    // 2. SCALA E SCOMPARSA DELLA GHIERA E DEL NUCLEO INTERNO
    if (ringRef.current) {
      const ringScale = Math.max(0.001, 1 - THREE.MathUtils.smoothstep(p, 0.18, 0.45));
      ringRef.current.scale.setScalar(
        THREE.MathUtils.lerp(ringRef.current.scale.x, ringScale, fastDamp)
      );
    }

    if (coreMeshRef.current && coreMatRef.current) {
      // Il nucleo brilla quando la pillola inizia ad aprirsi, poi svanisce per lasciare spazio al testo HTML
      const coreFadeOut = 1 - THREE.MathUtils.smoothstep(p, 0.32, 0.55);
      const targetCoreScale = (1 + scrollOpenProgress * 0.4) * Math.max(0.001, coreFadeOut);
      coreMeshRef.current.scale.setScalar(
        THREE.MathUtils.lerp(coreMeshRef.current.scale.x, targetCoreScale, fastDamp)
      );

      const baseGlow = hovered ? 1.2 : 0.4 + Math.sin(t * 2.0) * 0.08;
      const scrollBurst = Math.sin(THREE.MathUtils.smoothstep(p, 0.15, 0.45) * Math.PI) * 2.2;
      coreMatRef.current.emissiveIntensity = (baseGlow + scrollBurst) * coreFadeOut;
    }

    // 3. ROTAZIONE E POSIZIONE DEL GRUPPO PRINCIPALE (Mouse + Scroll)
    // All'inizio è inclinata a 35°, scrollando si dispone in diagonale/orizzontale (-Math.PI / 2.3)
    const baseRotZ = THREE.MathUtils.lerp(-0.42, -1.35, THREE.MathUtils.smoothstep(p, 0.0, 0.45));
    const targetRotX = 0.28 + mouseNorm.current.y * 0.25 * (1 - flyOutProgress);
    const targetRotY = -0.35 + mouseNorm.current.x * 0.35 + t * 0.08;
    const targetRotZ = baseRotZ + mouseNorm.current.x * -0.1;

    rootGroupRef.current.rotation.x = THREE.MathUtils.lerp(rootGroupRef.current.rotation.x, targetRotX, damp);
    rootGroupRef.current.rotation.y = THREE.MathUtils.lerp(rootGroupRef.current.rotation.y, targetRotY, damp);
    rootGroupRef.current.rotation.z = THREE.MathUtils.lerp(rootGroupRef.current.rotation.z, targetRotZ, damp);

    // Fluttuazione idle + effetto zoom/fly-through finale
    const floatY = Math.sin(t * 1.1) * 0.05 * (1 - scrollOpenProgress);
    const targetPosX = mouseNorm.current.x * 0.15 * (1 - scrollOpenProgress);
    const targetPosY = mouseNorm.current.y * 0.12 * (1 - scrollOpenProgress) + floatY;
    const targetPosZ = flyOutProgress * 1.8; // Avanza verso la camera in uscita

    rootGroupRef.current.position.x = THREE.MathUtils.lerp(rootGroupRef.current.position.x, targetPosX, damp);
    rootGroupRef.current.position.y = THREE.MathUtils.lerp(rootGroupRef.current.position.y, targetPosY, damp);
    rootGroupRef.current.position.z = THREE.MathUtils.lerp(rootGroupRef.current.position.z, targetPosZ, damp);

    // 4. LUCE SPECULARE CHE SEGUE IL MOUSE
    if (rimLightRef.current) {
      rimLightRef.current.position.x = THREE.MathUtils.lerp(
        rimLightRef.current.position.x,
        2.2 + mouseNorm.current.x * 2.0,
        damp
      );
      rimLightRef.current.position.y = THREE.MathUtils.lerp(
        rimLightRef.current.position.y,
        1.8 + mouseNorm.current.y * 2.0,
        damp
      );
    }
  });

  const radius = 0.58;
  const cylinderHeight = 0.74;

  return (
    <group>
      <pointLight ref={rimLightRef} position={[2.2, 1.8, 2.8]} intensity={20} color="#ffffff" distance={12} />

      <group
        ref={rootGroupRef}
        rotation={[0.28, -0.35, -0.42]}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
      >
        {/* NUCLEO ENERGETICO INTERNO BIANCO PURO */}
        <mesh ref={coreMeshRef}>
          <capsuleGeometry args={[radius * 0.46, cylinderHeight * 0.9, 24, 32]} />
          <meshStandardMaterial
            ref={coreMatRef}
            color="#ffffff"
            emissive="#ffffff"
            emissiveIntensity={0.4}
            roughness={0.15}
          />
        </mesh>

        {/* GHIERA METALLICA CENTRALE */}
        <mesh ref={ringRef} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[radius * 0.996, 0.018, 24, 64]} />
          <meshStandardMaterial color="#f4f4f5" metalness={0.98} roughness={0.12} />
        </mesh>

        {/* METÀ SUPERIORE: Vetro Fumé Scuro Semitrasparente */}
        <group ref={topHalfRef}>
          <mesh position={[0, cylinderHeight / 2, 0]}>
            <cylinderGeometry args={[radius, radius, cylinderHeight, 48, 1, true]} />
            <meshPhysicalMaterial
              color="#141418"
              transmission={0.78}
              transparent
              opacity={1}
              metalness={0.1}
              roughness={0.14}
              ior={1.45}
              thickness={0.7}
              clearcoat={1}
              clearcoatRoughness={0.08}
            />
          </mesh>
          <mesh position={[0, cylinderHeight, 0]}>
            <sphereGeometry args={[radius, 48, 32, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshPhysicalMaterial
              color="#141418"
              transmission={0.78}
              transparent
              opacity={1}
              metalness={0.1}
              roughness={0.14}
              ior={1.45}
              thickness={0.7}
              clearcoat={1}
              clearcoatRoughness={0.08}
            />
          </mesh>
        </group>

        {/* METÀ INFERIORE: Ossidiana Opaca Satinata */}
        <group ref={bottomHalfRef}>
          <mesh position={[0, -cylinderHeight / 2, 0]}>
            <cylinderGeometry args={[radius, radius, cylinderHeight, 48]} />
            <meshPhysicalMaterial
              color="#070709"
              metalness={0.75}
              roughness={0.35}
              clearcoat={0.3}
              clearcoatRoughness={0.2}
            />
          </mesh>
          <mesh position={[0, -cylinderHeight, 0]} rotation={[Math.PI, 0, 0]}>
            <sphereGeometry args={[radius, 48, 32, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshPhysicalMaterial
              color="#070709"
              metalness={0.75}
              roughness={0.35}
              clearcoat={0.3}
              clearcoatRoughness={0.2}
            />
          </mesh>
        </group>
      </group>
    </group>
  );
}

export default function HeroPillScrollytelling() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mouseNorm = useRef({ x: 0, y: 0 });
  const scrollProgress = useRef(0);
  const isGlobalPaused = useStore(animationsPausedStore);
  const [isInView, setIsInView] = useState(true);
  const [isReady, setIsReady] = useState(false);

  // 1. Tracciamento Mouse Passivo
  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      mouseNorm.current = {
        x: (e.clientX / window.innerWidth) * 2 - 1,
        y: -(e.clientY / window.innerHeight) * 2 + 1,
      };
    };
    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    return () => window.removeEventListener('pointermove', handlePointerMove);
  }, []);

  // 2. Orchestrazione GSAP ScrollTrigger (Sincronizza 3D + Testi DOM in Astro)
  useEffect(() => {
    const wrapper = document.getElementById('hero-scrolly-wrapper');
    const stage1Text = document.getElementById('hero-stage-1');
    const stage2Text = document.getElementById('hero-stage-2');
    const coreGlowDom = document.getElementById('hero-core-glow');
    const scrollHint = document.getElementById('hero-scroll-hint');

    if (!wrapper) return;

    const ctx = gsap.context(() => {
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: wrapper,
          start: 'top top',
          end: 'bottom bottom',
          scrub: 1.2,
          onUpdate: (self) => {
            scrollProgress.current = self.progress;
          },
        },
      });

      // Fase 1 (0.00 -> 0.28): Il titolo iniziale si ingrandisce leggermente e sfuma via
      if (stage1Text && scrollHint) {
        tl.to(
          [stage1Text, scrollHint],
          {
            scale: 1.08,
            opacity: 0,
            y: -30,
            ease: 'power2.inOut',
            duration: 0.28,
          },
          0
        );
      }

      // Bagliore radiale bianco che si espande all'apertura della pillola
      if (coreGlowDom) {
        tl.fromTo(
          coreGlowDom,
          { scale: 0.5, opacity: 0.15 },
          { scale: 1.6, opacity: 0.45, duration: 0.45, ease: 'power2.out' },
          0.2
        ).to(coreGlowDom, { opacity: 0.15, scale: 1.2, duration: 0.35 }, 0.65);
      }

      // Fase 2 (0.30 -> 0.72): I nuovi testi + CTA emergono dal cuore della pillola aperta
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
          0.30
        );
      }
    });

    return () => ctx.revert();
  }, []);

  // 3. Spegnimento automatico WebGL quando la Hero esce dallo schermo
  useEffect(() => {
    const wrapper = document.getElementById('hero-scrolly-wrapper');
    if (!wrapper) return;
    const observer = new IntersectionObserver(
      ([entry]) => setIsInView(entry.isIntersecting),
      { threshold: 0.01 }
    );
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, []);

  const shouldPause = isGlobalPaused || !isInView;

  return (
    <div
      ref={containerRef}
      className={`relative h-full w-full transition-opacity duration-700 ease-out ${
        isReady ? 'opacity-100' : 'opacity-0'
      }`}
      aria-hidden="true"
    >
      <Canvas
        dpr={[1, 1.5]}
        frameloop={shouldPause ? 'demand' : 'always'}
        camera={{ position: [0, 0, 4.0], fov: 35 }}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        onCreated={() => setIsReady(true)}
      >
        <ambientLight intensity={0.45} color="#ffffff" />
        <directionalLight position={[-4, 5, 3]} intensity={2.4} color="#ffffff" />
        <directionalLight position={[4, -4, -2]} intensity={0.9} color="#a1a1aa" />

        <Environment preset="studio" environmentIntensity={0.45} />

        <ScrollyPillMesh
          isPaused={shouldPause}
          mouseNorm={mouseNorm}
          scrollProgress={scrollProgress}
        />

        <ContactShadows
          position={[0, -1.7, 0]}
          opacity={0.45}
          scale={6}
          blur={2.6}
          far={3.5}
          color="#000000"
        />
      </Canvas>
    </div>
  );
}
```

---

### 3.2 Nuova Sezione Astro: `src/components/sections/HeroSection.astro`
*(Sostituisce interamente il vecchio layout a 2 colonne con lo Scrollytelling centrato a `320vh`)*

```astro
---
// src/components/sections/HeroSection.astro
import HeroPillScrollytelling from '@interactive/HeroPillScrollytelling';
---

<!-- Fallback SEO e No-JS: se JS è disattivato, entrambi i blocchi testuali sono subito visibili -->
<noscript>
  <style>
    #hero-scrolly-wrapper { height: auto !important; min-height: 100vh; padding: 8rem 0; }
    #hero-stage-1, #hero-stage-2 { opacity: 1 !important; transform: none !important; position: relative !important; pointer-events: auto !important; margin-bottom: 3rem; }
  </style>
</noscript>

<section
  id="hero-scrolly-wrapper"
  class="relative h-[320vh] w-full bg-[var(--bg-primary)] border-b border-[var(--border-subtle)]"
>
  <!-- Viewport Fissato durante i 320vh di scroll -->
  <div class="sticky top-0 h-screen w-full overflow-hidden flex items-center justify-center">
    
    <!-- Bagliore centrale monocromatico modulato dallo scroll -->
    <div
      id="hero-core-glow"
      class="pointer-events-none absolute h-[380px] w-[380px] sm:h-[520px] sm:w-[520px] rounded-full blur-[120px] opacity-20 gpu-accelerated"
      style="background: radial-gradient(circle, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0) 70%);"
      aria-hidden="true"
    ></div>

    <!-- LIVELLO 1 (z-10): Scena 3D a Tutto Schermo (Idratata in client:idle) -->
    <div class="absolute inset-0 z-10 flex items-center justify-center">
      <HeroPillScrollytelling client:idle />
    </div>

    <!-- LIVELLO 2 (z-20): Testi SEO Centrati Sincronizzati con l'Apertura della Pillola -->
    <div class="relative z-20 mx-auto max-w-5xl px-6 text-center w-full flex flex-col items-center justify-center pointer-events-none">
      
      <!-- FASE 1 (Visibile all'ingresso a 0ms per LCP perfetto): Titolo Monumentale -->
      <div id="hero-stage-1" class="flex flex-col items-center space-y-6 gpu-accelerated">
        <div class="inline-flex items-center gap-2.5 rounded-full border border-[var(--border-subtle)] bg-[#0c0c0e]/80 backdrop-blur-md px-4 py-1.5">
          <span class="h-1.5 w-1.5 rounded-full bg-white animate-pulse"></span>
          <span class="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--text-muted)]">
            NZT Solutions — Next-Gen Engineering
          </span>
        </div>

        <h1 class="text-metallic font-semibold tracking-tight text-4xl sm:text-6xl lg:text-7xl leading-[1.05] max-w-4xl">
          Sblocca il vero potenziale digitale della tua azienda.
        </h1>

        <p class="text-[var(--text-muted)] text-base sm:text-lg max-w-xl font-normal">
          Scorri per attivare l'architettura ad alte prestazioni.
        </p>
      </div>

      <!-- FASE 2 (Emerge dall'interno della Pillola quando si apre tra il 30% e il 75% dello scroll) -->
      <div
        id="hero-stage-2"
        class="absolute inset-x-6 flex flex-col items-center justify-center space-y-8 opacity-0 scale-[0.78] pointer-events-none gpu-accelerated"
      >
        <div class="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/[0.04] backdrop-blur-md px-3.5 py-1">
          <span class="font-mono text-xs uppercase tracking-widest text-white">
            Core Architecture Unlocked
          </span>
        </div>

        <h2 class="text-metallic font-semibold tracking-tight text-3xl sm:text-5xl lg:text-6xl leading-[1.08] max-w-3xl">
          Software su misura, Ecosistemi Web Zero-Latency & SEO Nativa.
        </h2>

        <p class="text-[var(--text-muted)] text-base sm:text-xl leading-relaxed max-w-2xl font-normal">
          Costruiamo piattaforme ultra-veloci progettate per dominare i motori di ricerca, automatizzare i processi critici e convertire i visitatori in clienti.
        </p>

        <div class="flex flex-wrap items-center justify-center gap-4 pt-2">
          <a
            href="#contatti"
            class="inline-flex items-center justify-center rounded-lg bg-white px-7 py-3.5 text-sm font-medium text-[#050505] shadow-[0_0_30px_rgba(255,255,255,0.2)] transition-all duration-300 hover:bg-zinc-200 hover:-translate-y-0.5"
          >
            Inizia un Progetto
          </a>
          <a
            href="#servizi"
            class="inline-flex items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[#0c0c0e]/90 backdrop-blur-md px-7 py-3.5 text-sm font-medium text-white transition-all duration-300 hover:border-[var(--border-hover)] hover:bg-[var(--bg-surface-elevated)]"
          >
            Esplora i Servizi
          </a>
        </div>
      </div>

    </div>

    <!-- Indicatore di Scroll Minimalista in Basso -->
    <div
      id="hero-scroll-hint"
      class="pointer-events-none absolute bottom-8 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-2"
    >
      <span class="font-mono text-[10px] uppercase tracking-[0.25em] text-[var(--text-subtle)]">
        Scroll to Open
      </span>
      <div class="h-9 w-[1px] bg-gradient-to-b from-white/50 to-transparent"></div>
    </div>

  </div>
</section>
```

---

## 4. Istruzioni Rapide per Claude

Quando passi questo file a Claude, scrivigli semplicemente:
> *"Applica questo documento di refactoring (v2.0) per sostituire l'attuale Hero Section a due colonne con la nuova versione Scrollytelling Awwwards centrata. Crea `src/components/interactive/HeroPillScrollytelling.tsx` e aggiorna `src/components/sections/HeroSection.astro` esattamente come specificato, lasciando intatto il resto del progetto."*