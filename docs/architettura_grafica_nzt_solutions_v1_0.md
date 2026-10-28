# NZT Solutions — Documento di Architettura Grafica & Design System (v1.0)

> **Progetto:** Sito Web Ufficiale & Landing Page Ad Alte Prestazioni (`nztsolutions.it`)  
> **Direzione Artistica:** Minimalismo Monocromatico Tecnico (*Obsidian, Graphite, Platinum & Pure White*)  
> **Elemento Scenografico Principale:** Capsula 3D Interattiva ("NZT Pill") a cinematica smorzata e sobria nella Hero Section  
> **Vincolo Architetturale:** Pieno rispetto del Performance Budget SEO ($\text{PageSpeed } 98-100/100$, $\text{LCP} < 1.2\text{ s}$, $\text{CLS} = 0.00$, $\text{INP} < 80\text{ ms}$)

---

## 1. Visione Estetica e Principi Direttivi

L'identità visiva di **NZT Solutions** si fonda su un'estetica **monocromatica rigorosa, pulita e autorevole**. L'assenza di colori saturi sposta l'attenzione dell'utente sulla qualità tipografica, sulla profondità dei materiali (vetro fumé, metallo satinato, nero ossidiana) e sulla precisione delle micro-interazioni:

1. **Monocromia Materica (Nero, Grigio, Bianco):** La gerarchia visiva non usa colori primari o accenti cromatici artificiali, ma lavora esclusivamente attraverso il contrasto di luminanza, la stratificazione delle superfici (`#050505` $\rightarrow$ `#0C0C0E` $\rightarrow$ `#16161A`) e bordi speculari di $1\text{ px}$ semitrasparenti.
2. **Sobrietà Cinetica (Fluidità Smorzata):** Tutte le animazioni rifiutano effetti rimbalzanti (*bounce*), rotazioni rapide o transizioni invasive. Ogni movimento è governato da interpolazione esponenziale smorzata (*damping*) per trasmettere stabilità, precisione ingegneristica e controllo.
3. **Unico Magnete Visivo 3D (Hero Section):** L'unico elemento tridimensionale complesso del sito è la **Pillola 3D NZT** nella Hero Section. Il resto della pagina mantiene un profilo ultraleggero basato su mockup UI vettoriali nel DOM e transizioni CSS/GSAP accelerate via GPU (`transform` e `opacity`).
4. **Zero Penalizzazione SEO:** L'elemento WebGL viene idratato in modalità differita (`client:idle`) sopra un placeholder statico ad altissima priorità, garantendo che i crawler di Google indicizzino istantaneamente l'HTML e che le metriche Core Web Vitals rimangano intatte.

---

## 2. Sistema Cromatico Acromatico & Design Tokens

Tutti i token sono definiti in modo semantico per garantire coerenza tra la Landing Page in Astro e la futura Area Clienti (`clienti.nztsolutions.it`).

### 2.1 Tabella dei Token Colore
| Ruolo Semantico | Variabile CSS | Valore Hex / RGBA | Utilizzo Specifico |
| :--- | :--- | :--- | :--- |
| **Sfondo Primario (Obsidian)** | `--bg-primary` | `#050505` | Sfondo globale del documento. Evita il `#000000` assoluto per prevenire l'effetto *black smearing* sui pannelli OLED mantenendo profondità totale. |
| **Superficie Base (Carbon)** | `--bg-surface` | `#0C0C0E` | Sfondo delle card statiche, dei blocchi della Bento Grid e dei contenitori di sezione. |
| **Superficie Elevata (Graphite)** | `--bg-surface-elevated` | `#16161A` | Stato `:hover` delle card, tab selezionate, header dei mockup interattivi e modali. |
| **Superficie Glass (Smoked)** | `--bg-glass` | `rgba(12, 12, 14, 0.72)` | Navbar fissa e badge fluttuanti combinati con `backdrop-filter: blur(12px)`. |
| **Testo Primario (Pure White)** | `--text-primary` | `#FAFAFA` | Intestazioni (`h1-h3`), numeri chiave, etichette attive e copy ad alto impatto. |
| **Testo Secondario (Silver Grey)** | `--text-muted` | `#A1A1AA` | Paragrafi descrittivi, sottotitoli della Hero, corpo delle FAQ e descrizioni dei servizi. |
| **Testo Tecnico (Zinc Muted)** | `--text-subtle` | `#52525B` | Metadati, numerazioni progressive (`01`, `02`), placeholder dei form e diciture legali. |
| **Accento Primario (Platinum)** | `--accent-primary` | `#FFFFFF` | Bottoni CTA principali (sfondo bianco pieno con testo `#050505`), indicatori di stato attivo e punti luce. |
| **Bagliore Speculare (Soft Glow)** | `--accent-glow` | `rgba(255, 255, 255, 0.10)` | Riflesso radiale soffuso dietro la pillola 3D e spotlight al passaggio del cursore sulle card. |
| **Bordo Sottile (Hairline)** | `--border-subtle` | `rgba(255, 255, 255, 0.08)` | Contorno standard di $1\text{ px}$ per card, divisori di sezione, input e griglie tecniche. |
| **Bordo Attivo (Specular Edge)** | `--border-hover` | `rgba(255, 255, 255, 0.22)` | Illuminazione sobria del bordo durante l'interazione (`:hover` o `:focus-visible`). |

### 2.2 Configurazione Completa `src/styles/global.css`
Questo file sostituisce la palette iniziale con il nuovo sistema monocromatico e introduce le utility grafiche per i riflessi metallici e l'accelerazione hardware:

```css
@import "tailwindcss";

@layer base {
  :root {
    --bg-primary: #050505;
    --bg-surface: #0c0c0e;
    --bg-surface-elevated: #16161a;
    --bg-glass: rgba(12, 12, 14, 0.72);
    --text-primary: #fafafa;
    --text-muted: #a1a1aa;
    --text-subtle: #52525b;
    --accent-primary: #ffffff;
    --accent-glow: rgba(255, 255, 255, 0.10);
    --border-subtle: rgba(255, 255, 255, 0.08);
    --border-hover: rgba(255, 255, 255, 0.22);
  }

  html {
    background-color: var(--bg-primary);
    color: var(--text-primary);
    scroll-behavior: auto; /* Gestito da Lenis */
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    text-rendering: optimizeLegibility;
  }

  ::selection {
    background-color: #ffffff;
    color: #050505;
  }
}

/* Accelerazione GPU per evitare repaint durante lo scroll */
.gpu-accelerated {
  will-change: transform, opacity;
  transform: translateZ(0);
  backface-visibility: hidden;
}

/* Gradiente tipografico platino/argento per gli H1 e H2 */
.text-metallic {
  background: linear-gradient(180deg, #ffffff 0%, #ffffff 45%, #71717a 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

/* Griglia tecnica di sfondo a bassissima opacità per la Bento Grid */
.bg-technical-grid {
  background-size: 24px 24px;
  background-image: radial-gradient(rgba(255, 255, 255, 0.06) 1px, transparent 1px);
}

/* Effetto Spotlight sobrio controllato dal cursore */
.specular-card {
  position: relative;
  background: radial-gradient(
      600px circle at var(--mouse-x, 50%) var(--mouse-y, -200px),
      rgba(255, 255, 255, 0.055),
      transparent 45%
    ),
    var(--bg-surface);
  border: 1px solid var(--border-subtle);
  transition: border-color 0.35s cubic-bezier(0.16, 1, 0.3, 1),
              background-color 0.35s cubic-bezier(0.16, 1, 0.3, 1);
}

.specular-card:hover {
  border-color: var(--border-hover);
}
```

---

## 3. Tipografia e Gerarchia Editoriale

Per azzerare le richieste di rete esterne e mantenere $\text{CLS} = 0.00$, i font sono ospitati localmente in formato `.woff2` tramite `@fontsource` con `font-display: swap`.

* **Font Primario (UI & Titoli):** **Geist Sans** (o **Inter**). Caratterizzato da proporzioni geometriche neutre e alta leggibilità.
* **Font Tecnico (Metriche, Tag, Mockup):** **Geist Mono** (o **JetBrains Mono**). Utilizzato per badge, codici di stato nei simulatori DOM, numerazione delle sezioni e dati prestazionali.

### Scala Tipografica Fluida
| Elemento | Dimensione (`clamp`) | Peso & Tracking | Colore / Stile |
| :--- | :--- | :--- | :--- |
| **Hero `<h1>`** | `clamp(2.5rem, 5vw + 1rem, 4.5rem)` | `font-semibold` (`600`), `tracking-tight` (`-0.035em`), `leading-[1.08]` | `.text-metallic` (Bianco puro che sfuma in argento alla base) |
| **Titolo Sezione `<h2>`** | `clamp(1.875rem, 3vw + 0.5rem, 3rem)` | `font-medium` (`500`), `tracking-tight` (`-0.025em`), `leading-[1.15]` | `#FAFAFA` |
| **Titolo Card `<h3>`** | `clamp(1.25rem, 1.5vw + 0.5rem, 1.5rem)` | `font-medium` (`500`), `tracking-snug` (`-0.015em`) | `#FAFAFA` |
| **Body Lead (Sottotitoli)** | `clamp(1.05rem, 1vw + 0.5rem, 1.25rem)` | `font-normal` (`400`), `leading-relaxed` (`1.65`) | `#A1A1AA` (max-width `62ch`) |
| **Body Standard** | `1rem` ($16\text{ px}$) | `font-normal` (`400`), `leading-relaxed` (`1.6`) | `#A1A1AA` |
| **Etichette / Badge** | `0.75rem` ($12\text{ px}$) | `font-mono`, `uppercase`, `tracking-widest` (`0.08em`) | `#FAFAFA` o `#A1A1AA` |

---

## 4. Hero Section: La Pillola 3D ("NZT Pill") Fluida, Sobria e SEO-Safe

L'animazione della pillola 3D nella Hero Section è progettata per apparire come un oggetto industriale di alta precisione sospeso nello spazio.

### 4.1 Fisica del Movimento e Sobrietà dell'Interazione
Per evitare qualsiasi effetto caotico o videoludico, la cinematica della capsula segue tre leggi fisiche rigorose:

1. **Interpolazione Esponenziale Smorzata (Heavy Damping):**
   La posizione e l'inclinazione della pillola non seguono mai rigidamente il mouse, ma applicano una formula di smorzamento esponenziale ad ogni fotogramma ($\Delta t$):
   $$x_{t+1} = x_t + (x_{\text{target}} - x_t) \cdot \left(1 - e^{-\lambda \Delta t}\right)$$
   Con un coefficiente di smorzamento $\lambda = 3.2$, la pillola possiede "inerzia e peso": quando l'utente muove il cursore, la capsula risponde con una rotazione vellutata che decelera dolcemente fino a fermarsi.
2. **Fluttuazione Meditativa in Stato Idle:**
   Quando il mouse è fermo, la pillola compie una lentissima oscillazione verticale sinusoidale ($\pm 0.08\text{ unità}$ con periodo di $6\text{ secondi}$) e una rotazione assiale impercettibile.
3. **Micro-Reazione in Hover (Precision Micro-Reveal):**
   Passando il cursore direttamente sulla pillola, non avvengono esplosioni o rotazioni veloci: le due metà della capsula si distanziano lungo l'asse longitudinale di soli $0.065\text{ unità}$ (un'apertura millimetrica elegante), la ghiera centrale in titanio riflette più luce e il nucleo interno aumenta dolcemente la propria luminanza bianca da $0.25$ a $0.75$.

### 4.2 Composizione Materica (Monochrome PBR)
* **Calotta Superiore (Smoked Quartz Glass):** Materiale fisico semitrasparente scuro (`transmission: 0.82`, `ior: 1.45`, `roughness: 0.15`, `color: #141418`) che lascia intravedere l'anima interna con rifrazione reale.
* **Calotta Inferiore (Anodized Matte Obsidian):** Polimero/metallo nero opaco ad alta densità (`color: #08080a`, `metalness: 0.65`, `roughness: 0.42`, `clearcoat: 0.3`).
* **Ghiera Centrale (Brushed Titanium Ring):** Anello di giunzione sottile in titanio spazzolato (`color: #d4d4d8`, `metalness: 0.95`, `roughness: 0.22`) che cattura la *Rim Light* laterale durante l'inclinazione.
* **Nucleo Interno (Pure White Core):** Cilindro interno con emissione luminosa acromatica (`#ffffff`) che crea un bagliore soffuso attraverso la calotta superiore in vetro fumé.

### 4.3 Dipendenze Aggiuntive per il Modulo 3D
Nel `package.json`, assicurarsi di includere i pacchetti WebGL (che verranno scaricati dal browser **solo** in background grazie a `client:idle`):

```json
{
  "dependencies": {
    "three": "^0.172.0",
    "@react-three/fiber": "^9.0.0",
    "@react-three/drei": "^10.0.0"
  },
  "devDependencies": {
    "@types/three": "^0.172.0"
  }
}
```

### 4.4 Codice Completo: `src/components/interactive/HeroPill3D.tsx`
Questo componente implementa la pillola 3D procedurale (zero file `.glb` esterni da scaricare, peso ridotto al minimo), si sincronizza con `animationsPausedStore` e interrompe automaticamente il rendering WebGL quando la Hero esce dallo schermo (`IntersectionObserver`).

```tsx
// src/components/interactive/HeroPill3D.tsx
import React, { useRef, useState, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment, ContactShadows, Float } from '@react-three/drei';
import * as THREE from 'three';
import { useStore } from '@nanostores/react';
import { animationsPausedStore } from '@/lib/stores/uiStore';

interface PillMeshProps {
  isPaused: boolean;
  mouseNorm: React.MutableRefObject<{ x: number; y: number }>;
}

function NZTPillMesh({ isPaused, mouseNorm }: PillMeshProps) {
  const groupRef = useRef<THREE.Group>(null);
  const topHalfRef = useRef<THREE.Group>(null);
  const bottomHalfRef = useRef<THREE.Group>(null);
  const coreMaterialRef = useRef<THREE.MeshStandardMaterial>(null);
  const rimLightRef = useRef<THREE.PointLight>(null);

  const [hovered, setHovered] = useState(false);

  // Gestione cursore sobria
  useEffect(() => {
    document.body.style.cursor = hovered ? 'pointer' : 'auto';
    return () => {
      document.body.style.cursor = 'auto';
    };
  }, [hovered]);

  useFrame((state, delta) => {
    if (isPaused || !groupRef.current) return;

    // Limitiamo delta per evitare salti se l'utente cambia tab del browser
    const dt = Math.min(delta, 0.1);
    const t = state.clock.getElapsedTime();

    // Fattore di smorzamento esponenziale (lambda = 3.2 per movimento fluido e pesante)
    const damp = 1 - Math.exp(-3.2 * dt);
    const microDamp = 1 - Math.exp(-5.0 * dt);

    // 1. Inclinazione principale orientata in modo indiretto e morbido dal cursore
    const targetRotX = 0.35 + mouseNorm.current.y * 0.28 + Math.sin(t * 0.7) * 0.04;
    const targetRotY = -0.45 + mouseNorm.current.x * 0.38 + t * 0.12; // Rotazione assiale lentissima
    const targetRotZ = -0.38 + mouseNorm.current.x * -0.12;

    groupRef.current.rotation.x = THREE.MathUtils.lerp(groupRef.current.rotation.x, targetRotX, damp);
    groupRef.current.rotation.y = THREE.MathUtils.lerp(groupRef.current.rotation.y, targetRotY, damp);
    groupRef.current.rotation.z = THREE.MathUtils.lerp(groupRef.current.rotation.z, targetRotZ, damp);

    // 2. Micro-spostamento parallasse (molto contenuto)
    const targetPosX = mouseNorm.current.x * 0.18;
    const targetPosY = mouseNorm.current.y * 0.14 + Math.sin(t * 1.1) * 0.06;

    groupRef.current.position.x = THREE.MathUtils.lerp(groupRef.current.position.x, targetPosX, damp);
    groupRef.current.position.y = THREE.MathUtils.lerp(groupRef.current.position.y, targetPosY, damp);

    // 3. Micro-apertura longitudinale della capsula in stato di Hover (sobria: 0.065 unità)
    const separationOffset = hovered ? 0.065 : 0.0;
    if (topHalfRef.current && bottomHalfRef.current) {
      topHalfRef.current.position.y = THREE.MathUtils.lerp(
        topHalfRef.current.position.y,
        separationOffset,
        microDamp
      );
      bottomHalfRef.current.position.y = THREE.MathUtils.lerp(
        bottomHalfRef.current.position.y,
        -separationOffset,
        microDamp
      );
    }

    // 4. Modulazione dell'intensità luminosa del nucleo interno in Hover
    if (coreMaterialRef.current) {
      const targetEmissive = hovered ? 0.85 : 0.28 + Math.sin(t * 1.8) * 0.06;
      coreMaterialRef.current.emissiveIntensity = THREE.MathUtils.lerp(
        coreMaterialRef.current.emissiveIntensity,
        targetEmissive,
        microDamp
      );
    }

    // 5. Spostamento dinamico del riflesso speculare con il mouse
    if (rimLightRef.current) {
      rimLightRef.current.position.x = THREE.MathUtils.lerp(
        rimLightRef.current.position.x,
        2.5 + mouseNorm.current.x * 1.8,
        damp
      );
      rimLightRef.current.position.y = THREE.MathUtils.lerp(
        rimLightRef.current.position.y,
        2.0 + mouseNorm.current.y * 1.8,
        damp
      );
    }
  });

  const radius = 0.56;
  const cylinderHeight = 0.72;

  return (
    <group>
      {/* Luce speculare dinamica che segue dolcemente il mouse */}
      <pointLight ref={rimLightRef} position={[2.5, 2.0, 2.5]} intensity={18} color="#ffffff" distance={10} />

      <Float
        speed={isPaused ? 0 : 1.2}
        rotationIntensity={isPaused ? 0 : 0.08}
        floatIntensity={isPaused ? 0 : 0.15}
      >
        <group
          ref={groupRef}
          rotation={[0.35, -0.45, -0.38]}
          onPointerOver={(e) => {
            e.stopPropagation();
            setHovered(true);
          }}
          onPointerOut={() => setHovered(false)}
        >
          {/* NUCLEO INTERNO LUMINOSO (Visibile attraverso il vetro fumé e la micro-apertura) */}
          <mesh>
            <capsuleGeometry args={[radius * 0.52, cylinderHeight * 1.1, 24, 32]} />
            <meshStandardMaterial
              ref={coreMaterialRef}
              color="#ffffff"
              emissive="#ffffff"
              emissiveIntensity={0.28}
              roughness={0.2}
            />
          </mesh>

          {/* GHIERA CENTRALE IN TITANIO SPAZZOLATO */}
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[radius * 0.995, 0.018, 24, 64]} />
            <meshStandardMaterial
              color="#e4e4e7"
              metalness={0.96}
              roughness={0.18}
            />
          </mesh>

          {/* METÀ SUPERIORE: Vetro Fumé Scuro Semitrasparente (Smoked Quartz) */}
          <group ref={topHalfRef}>
            {/* Cilindro superiore */}
            <mesh position={[0, cylinderHeight / 2, 0]}>
              <cylinderGeometry args={[radius, radius, cylinderHeight, 48, 1, true]} />
              <meshPhysicalMaterial
                color="#141418"
                transmission={0.78}
                opacity={1}
                transparent
                metalness={0.1}
                roughness={0.14}
                ior={1.45}
                thickness={0.6}
                clearcoat={1}
                clearcoatRoughness={0.08}
              />
            </mesh>
            {/* Calotta sferica superiore */}
            <mesh position={[0, cylinderHeight, 0]}>
              <sphereGeometry args={[radius, 48, 32, 0, Math.PI * 2, 0, Math.PI / 2]} />
              <meshPhysicalMaterial
                color="#141418"
                transmission={0.78}
                opacity={1}
                transparent
                metalness={0.1}
                roughness={0.14}
                ior={1.45}
                thickness={0.6}
                clearcoat={1}
                clearcoatRoughness={0.08}
              />
            </mesh>
          </group>

          {/* METÀ INFERIORE: Ossidiana Satinata Opaca (Matte Obsidian) */}
          <group ref={bottomHalfRef}>
            {/* Cilindro inferiore */}
            <mesh position={[0, -cylinderHeight / 2, 0]}>
              <cylinderGeometry args={[radius, radius, cylinderHeight, 48]} />
              <meshPhysicalMaterial
                color="#08080a"
                metalness={0.7}
                roughness={0.38}
                clearcoat={0.25}
                clearcoatRoughness={0.25}
              />
            </mesh>
            {/* Calotta sferica inferiore */}
            <mesh position={[0, -cylinderHeight, 0]} rotation={[Math.PI, 0, 0]}>
              <sphereGeometry args={[radius, 48, 32, 0, Math.PI * 2, 0, Math.PI / 2]} />
              <meshPhysicalMaterial
                color="#08080a"
                metalness={0.7}
                roughness={0.38}
                clearcoat={0.25}
                clearcoatRoughness={0.25}
              />
            </mesh>
          </group>
        </group>
      </Float>
    </group>
  );
}

export default function HeroPill3D() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mouseNorm = useRef({ x: 0, y: 0 });
  const isGlobalPaused = useStore(animationsPausedStore);
  const [isInView, setIsInView] = useState(true);
  const [isReady, setIsReady] = useState(false);

  // Tracciamento globale e leggero del mouse (passivo, zero reflow)
  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      const x = (e.clientX / window.innerWidth) * 2 - 1;
      const y = -(e.clientY / window.innerHeight) * 2 + 1;
      mouseNorm.current = { x, y };
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    return () => window.removeEventListener('pointermove', handlePointerMove);
  }, []);

  // Disattiva completamente il loop WebGL quando l'utente scorre oltre la Hero Section
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => setIsInView(entry.isIntersecting),
      { threshold: 0.05 }
    );
    observer.observe(containerRef.current);
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
        dpr={[1, 1.5]} // Limita il pixel ratio a 1.5x per garantire 60fps costanti anche su display 4K
        frameloop={shouldPause ? 'demand' : 'always'}
        camera={{ position: [0, 0, 4.2], fov: 36 }}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        onCreated={() => setIsReady(true)}
      >
        <ambientLight intensity={0.4} color="#ffffff" />
        <directionalLight position={[-4, 4, 2]} intensity={2.2} color="#ffffff" />
        <directionalLight position={[3, -3, -2]} intensity={0.8} color="#a1a1aa" />

        {/* Riflessi studio monocromatici puliti */}
        <Environment preset="studio" environmentIntensity={0.45} />

        <NZTPillMesh isPaused={shouldPause} mouseNorm={mouseNorm} />

        <ContactShadows
          position={[0, -1.65, 0]}
          opacity={0.55}
          scale={5}
          blur={2.4}
          far={3}
          color="#000000"
        />
      </Canvas>
    </div>
  );
}
```

### 4.5 Integrazione SEO-First in `src/components/sections/HeroSection.astro`
Il testo `<h1>`, il sottotitolo e le CTA sono renderizzati in HTML statico puro (**$0\text{ KB}$ di JS**). Mentre il browser è in fase di caricamento iniziale, nel contenitore di destra viene mostrato un **placeholder SVG/CSS vettoriale ultraleggero** che scompare in dissolvenza non appena `HeroPill3D` completa l'idratazione in `client:idle`.

```astro
---
// src/components/sections/HeroSection.astro
import HeroPill3D from '@interactive/HeroPill3D';
---

<section class="relative min-h-[90vh] flex items-center overflow-hidden border-b border-[var(--border-subtle)] pt-24 pb-16">
  <!-- Bagliore ambientale monocromatico statico (0 costo GPU) -->
  <div
    class="pointer-events-none absolute top-1/2 right-[12%] -translate-y-1/2 h-[420px] w-[420px] rounded-full blur-[130px]"
    style="background: radial-gradient(circle, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0) 70%);"
    aria-hidden="true"
  ></div>

  <div class="mx-auto max-w-7xl px-6 lg:px-8 w-full">
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
      
      <!-- COLONNA SINISTRA: Contenuto Testuale SEO (Renderizzato a 0ms) -->
      <div class="lg:col-span-7 space-y-8 z-10">
        <div class="inline-flex items-center gap-2.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-1.5">
          <span class="h-1.5 w-1.5 rounded-full bg-white animate-pulse"></span>
          <span class="font-mono text-xs uppercase tracking-widest text-[var(--text-muted)]">
            Architetture Software & Soluzioni Digitali
          </span>
        </div>

        <h1 class="text-metallic font-semibold tracking-tight text-4xl sm:text-6xl lg:text-[4.25rem] leading-[1.06]">
          Ingegneria digitale ad alte prestazioni per il tuo business.
        </h1>

        <p class="text-[var(--text-muted)] text-lg sm:text-xl leading-relaxed max-w-2xl font-normal">
          Progettiamo ecosistemi web, software su misura e automazioni aziendali con architettura Zero-Latency. Estetica minimale, velocità estrema e posizionamento SEO nativo.
        </p>

        <div class="flex flex-wrap items-center gap-4 pt-2">
          <a
            href="#contatti"
            class="inline-flex items-center justify-center rounded-lg bg-white px-6 py-3.5 text-sm font-medium text-[#050505] transition-all duration-300 hover:bg-zinc-200 hover:-translate-y-0.5"
          >
            Inizia un Progetto
          </a>
          <a
            href="#servizi"
            class="inline-flex items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-6 py-3.5 text-sm font-medium text-white transition-all duration-300 hover:border-[var(--border-hover)] hover:bg-[var(--bg-surface-elevated)]"
          >
            Esplora l'Architettura
          </a>
        </div>
      </div>

      <!-- COLONNA DESTRA: Contenitore ad Altezza Fissa (CLS = 0.00) per la Pillola 3D -->
      <div class="lg:col-span-5 relative h-[420px] sm:h-[500px] w-full flex items-center justify-center">
        <!-- Sagoma statica istantanea visibile prima dell'idratazione WebGL -->
        <div
          class="pointer-events-none absolute inset-0 flex items-center justify-center opacity-30"
          aria-hidden="true"
        >
          <div class="h-56 w-24 -rotate-[25deg] rounded-full border border-white/15 bg-gradient-to-b from-white/10 via-zinc-900/40 to-black shadow-2xl"></div>
        </div>

        <!-- Isola React 3D caricata solo quando il main thread è libero -->
        <HeroPill3D client:idle />
      </div>

    </div>
  </div>
</section>
```

---

## 5. Linee Guida Cinetiche e Struttura delle Sezioni (SEO-Safe)

Tutte le sezioni successive alla Hero adottano micro-interazioni leggere che non superano mai il budget prestazionale.

### 5.1 Parametri Fisici Standard (GSAP & Motion)
* **Curva di Easing Unificata:** `power3.out` in GSAP oppure `cubic-bezier(0.16, 1, 0.3, 1)` in CSS/Motion.
* **Durata delle Transizioni:**
  * Micro-interazioni UI (hover bottoni, cambio tab, bordi card): $250\text{ ms} - 350\text{ ms}$.
  * Rivelazione elementi allo scroll (`[data-animate="fade-up"]`): $750\text{ ms}$ con traslazione verticale contenuta (`y: 24px` $\rightarrow$ `0px`), evitando spostamenti ampi che affaticano la lettura.
* **Proprietà Vietate:** È severamente vietato animare `blur()`, `box-shadow` complessi o proprietà di layout (`height`, `width`, `margin`) durante lo scroll.

### 5.2 Specifica Grafica delle Singole Sezioni

1. **`Navbar.astro` (Header Fisso Minimalista):**
   * Altezza contenuta ($64\text{ px}$), sfondo `var(--bg-glass)` con `backdrop-filter: blur(12px)` e bordo inferiore `1px solid var(--border-subtle)`.
   * Include sulla destra il collegamento predisposto per la futura **Area Clienti** (`clienti.nztsolutions.it`) stilizzato come bottone `ghost` con icona lucchetto/terminale minimale, affiancato dalla CTA primaria bianca.
2. **`TrustBar.astro` (Tecnologie & Metriche):**
   * Striscia orizzontale con bordo superiore e inferiore `1px solid var(--border-subtle)`.
   * I loghi tecnologici e i numeri chiave sono resi al $100\%$ in monocromia (`#71717A`) con passaggio a `#FAFAFA` in hover. L'animazione *marquee* usa solo CSS `@keyframes` su `translate3d`.
3. **`ProblemSolution.astro` (Confronto Architetturale):**
   * Due card speculari: a sinistra *"Siti Web Tradizionali"* (sfondo `#08080A`, bordo tratteggiato `rgba(255,255,255,0.06)`, indicatori grigio scuro `#52525B`); a destra *"Standard NZT Solutions"* (sfondo `.specular-card`, bordo continuo `rgba(255,255,255,0.20)`, badge bianchi ad alto contrasto e metriche in font monospace).
4. **`ServicesSection.astro` + `ServicesBentoTabs.tsx` (Bento Grid Vettoriale):**
   * Griglia a 3 colonne su desktop con card dotate di classe `.specular-card` e texture `.bg-technical-grid`.
   * I mockup interni alle card sono costruiti in HTML/React puro: simulano grafici di latenza, terminali di deploy e flussi di automazione usando esclusivamente linee bianche sottili, badge grigio grafite e indicatori luminosi bianchi.
5. **`MethodSection.astro` + `WorkflowSimulator.tsx` (Timeline Ingegneristica):**
   * Layout editoriale con numerazione monumentale (`01`, `02`, `03`, `04`) in font monospace (`text-5xl text-zinc-800`) che si illumina in `#FAFAFA` quando lo step corrispondente entra nella zona attiva dello schermo.
6. **`FaqSection.astro` + `FaqAccordion.tsx`:**
   * Lista pulita separata da linee `1px solid var(--border-subtle)`. L'icona `+` ruota di $45^\circ$ diventando una `×` bianca con transizione fluida. Tutto il testo delle risposte è già presente nel DOM statico e mappato in JSON-LD (`FAQPage`) per Google.

---

## 6. Componenti Atomici Condivisibili (`src/components/ui/`)

Questi componenti sono pronti per essere utilizzati sia nella Landing Page sia nella futura Area Clienti (`clienti.nztsolutions.it`).

### 6.1 `src/components/ui/Card.tsx` (Con Spotlight Monocromatico Leggero)
Aggiorna le coordinate del mouse tramite variabili CSS locali senza mai innescare un *re-render* di React:

```tsx
// src/components/ui/Card.tsx
import React, { useRef } from 'react';
import { cn } from '@/lib/utils';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  spotlight?: boolean;
}

export function Card({ className, spotlight = true, children, ...props }: CardProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!spotlight || !cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    cardRef.current.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
    cardRef.current.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
  };

  return (
    <div
      ref={cardRef}
      onPointerMove={handlePointerMove}
      className={cn(
        'rounded-2xl p-6 sm:p-8',
        spotlight ? 'specular-card' : 'bg-[var(--bg-surface)] border border-[var(--border-subtle)]',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
```

### 6.2 `src/components/ui/Button.tsx` (Varianti Monocromatiche CVA)
```tsx
// src/components/ui/Button.tsx
import React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 disabled:pointer-events-none disabled:opacity-40 cursor-pointer',
  {
    variants: {
      variant: {
        primary:
          'bg-[#FAFAFA] text-[#050505] hover:bg-zinc-200 hover:-translate-y-0.5 shadow-[0_0_25px_rgba(255,255,255,0.12)]',
        secondary:
          'bg-[#16161A] text-[#FAFAFA] border border-[var(--border-subtle)] hover:border-[var(--border-hover)] hover:bg-zinc-800/80',
        ghost:
          'bg-transparent text-[#A1A1AA] hover:text-[#FAFAFA] hover:bg-white/[0.04]',
      },
      size: {
        sm: 'h-9 px-3.5 text-xs',
        md: 'h-11 px-5 text-sm',
        lg: 'h-12 px-7 text-sm',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <button className={cn(buttonVariants({ variant, size, className }))} {...props} />
  );
}
```

---

## 7. Checklist di Validazione Grafica & SEO (Pre-Deploy Gate)

Prima di andare online su `nztsolutions.it`, l'implementazione grafica deve superare questi 6 controlli:

| Controllo | Valore Atteso | Metodo di Verifica |
| :--- | :--- | :--- |
| **1. Coerenza Acromatica** | $0$ colori saturi fuori palette | Tutti gli esadecimali appartengono alla scala `#050505` $\leftrightarrow$ `#FAFAFA`. |
| **2. Zero Layout Shift sulla Hero 3D** | $\text{CLS} = 0.00$ | Il contenitore della pillola 3D ha altezza esplicita (`h-[420px] sm:h-[500px]`) prima dell'idratazione di `HeroPill3D.tsx`. |
| **3. Sospensione Automatica GPU** | `frameloop="demand"` fuori viewport | Scorrendo fino alla sezione Servizi o cliccando su `AnimationToggle`, l'uso della GPU del canvas 3D scende a $0\%$. |
| **4. Contrasto Accessibilità (WCAG AA)** | Rapporto $\ge 4.5:1$ | Il testo secondario `#A1A1AA` su sfondo `#050505` garantisce un rapporto di contrasto di $7.8:1$ (superiore allo standard AAA). |
| **5. Idratazione Selettiva** | $< 35\text{ KB}$ JS al caricamento | Il bundle di Three.js viene scaricato solo in `client:idle` dopo il completamento del First Contentful Paint. |
| **6. Visibilità No-JS per i Crawler** | $100\%$ dei testi visibili | Disabilitando JavaScript nel browser, l'`<h1>`, le card della Bento Grid, il placeholder della pillola e le FAQ sono perfettamente leggibili. |