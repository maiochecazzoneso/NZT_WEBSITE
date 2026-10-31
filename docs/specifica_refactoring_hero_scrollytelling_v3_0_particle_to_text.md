# PROMPT MASTER PER CLAUDE — Refactoring Hero Section: 3D Pill + Particle-to-Text Scrollytelling (v3.0)

> **Istruzione d'uso:** Copia e incolla l'intero contenuto di questo documento a Claude per fargli aggiornare la Hero Section del sito **NZT Solutions** (`nztsolutions.it`).

---

## RUOLO E OBIETTIVO PER CLAUDE

Agisci come un **Creative Developer Senior (Awwwards SOTD Level)** specializzato in **Astro 5, React 19, Three.js / React Three Fiber, Custom GLSL Shaders e GSAP ScrollTrigger**.

Il sito ha già una base funzionante, ma dobbiamo **sostituire l'attuale Hero Section** con una **Hero Scrollytelling a tutto schermo (`360vh`)** in cui i testi non compaiono con un semplice fade-in, ma vengono **fisicamente generati e composti da uno sciame di particelle luminose monocromatiche** che fuoriescono dal nucleo interno della **Pillola 3D NZT** mentre questa si apre allo scroll.

Non modificare il resto del sito (`Navbar`, `TrustBar`, `ServicesSection`, `global.css`, `uiStore.ts`), ma concentrati esclusivamente sull'aggiornamento di:
1. `src/components/interactive/HeroPillScrollytelling.tsx`
2. `src/components/sections/HeroSection.astro`

---

## 1. ARCHITETTURA IBRIDA "PARTICLE-TO-DOM" (EFFETTO AWWWARDS + 100% SEO)

Per ottenere l'effetto delle particelle che escono dalla pillola e compongono le lettere senza perdere la leggibilità dei paragrafi, l'interattività dei bottoni e l'indicizzazione SEO di Google, devi implementare una **pipeline ibrida a 4 stadi sincronizzata con `ScrollTrigger` (`scrub: 1.2`)**:

1. **Campionamento Tipografico Offscreen (Zero asset esterni pesanti):**
   All'avvio del componente React (`client:idle`), genera un `<canvas>` 2D invisibile in memoria ($1200 \times 450\text{ px}$), disegna al suo interno il titolo principale della Hero (es. `"ARCHITETTURE"` / `"ZERO-LATENCY"`), scansiona i pixel con `ctx.getImageData()` ed estrai fino a $5.500$ coordinate $(x, y)$ dei pixel pieni, convertendole in coordinate 3D (`aTarget`) nello spazio della camera WebGL.
2. **Stato 1 — Confinamento nel Nucleo (`Scroll 0.00 -> 0.18`):**
   La Pillola 3D è chiusa al centro dello schermo e risponde al mouse con inerzia pesante ($\lambda = 3.5$). Tutte le $5.500$ particelle si trovano compresse all'interno del nucleo della pillola (`position` sferica con raggio $< 0.32$), visibili in trasparenza attraverso la calotta superiore in vetro fumé (*Smoked Quartz Glass*). L'`<h1>` iniziale d'impatto è visibile e sfuma via appena inizia lo scroll.
3. **Stato 2 — Apertura Capsula & Esplosione Turbolenta (`Scroll 0.18 -> 0.45`):**
   Le due metà della pillola 3D (vetro fumé superiore e ossidiana opaca inferiore) si aprono lungo il loro asse e si allontanano. Dal varco centrale, lo shader GLSL libera le particelle in uno sciame vorticoso tridimensionale bianco/argento governato da funzioni trigonometriche di turbolenza (*curl-like noise*), creando l'effetto di energia che fuoriesce dalla capsula.
4. **Stato 3 — Coalescenza Magnetica nelle Lettere (`Scroll 0.45 -> 0.78`):**
   Mentre le due calotte della pillola scivolano verso i margini esterni dello schermo, la turbolenza si azzera e ogni singola particella converge con precisione magnetica verso la propria coordinata tipografica `aTarget`, **componendo visivamente le lettere del titolo al centro dello schermo**. Muovendo il mouse sulle lettere composte dalle particelle, un campo di repulsione radiale nello shader sposta dolcemente i punti luce attorno al cursore.
5. **Stato 4 — Handoff DOM Nitido, Sottotitolo e CTA (`Scroll 0.75 -> 1.00`):**
   Quando le particelle hanno completato al $100\%$ la formazione della scritta, il vero nodo HTML SEO (`#hero-stage-2`) perfettamente sovrapposto esegue un *cross-fade* fluido (`opacity: 0 -> 1`, rimozione progressiva del `filter: blur()`), mentre il sottotitolo e i bottoni CTA emergono con un effetto di *crystallize reveal* parola per parola, garantendo testo vettoriale nitidissimo, selezionabile dall'utente e **100% indicizzato da Googlebot**.

---

## 2. MATEMATICA DELLO SHADER GLSL DELLE PARTICELLE

Il sistema particellare (`ParticleTypographySystem`) deve usare un `THREE.ShaderMaterial` custom su `THREE.BufferGeometry` per eseguire tutti i calcoli sulla GPU a $60\text{-}120\text{ FPS}$ con **0% di carico sulla CPU**:

* **Interpolazione Posizione nel Vertex Shader:**
  Ogni particella $i$ possiede una posizione iniziale nel nucleo della pillola $\mathbf{p}_{\text{core}, i}$, una posizione finale sulla lettera $\mathbf{p}_{\text{text}, i}$ e un vettore casuale $\mathbf{r}_i$. Dato il progresso di apertura $u_{\text{open}} \in [0, 1]$ e il progresso di coalescenza $u_{\text{coalesce}} \in [0, 1]$:
  $$\mathbf{p}_i(t) = \text{mix}\left(\mathbf{p}_{\text{core}, i}, \mathbf{p}_{\text{text}, i}, u_{\text{coalesce}}\right) + \mathbf{T}_i(t) \cdot \sin(\pi \cdot u_{\text{open}}) \cdot (1 - u_{\text{coalesce}})$$
  dove $\mathbf{T}_i(t)$ è il vettore di dispersione vorticosa elicoidale che spinge le particelle fuori dall'anello centrale della pillola mentre questa si apre.
* **Interazione Mouse sulle Particelle:**
  Quando le particelle stanno componendo o hanno composto la scritta, la distanza $d = \|\mathbf{p}_{xy} - \mathbf{m}_{xy}\|$ dal cursore genera una spinta elastica radiale morbida per rendere viva la tipografia particellare.
* **Fragment Shader Monocromatico:**
  Ogni particella è renderizzata come una micro-sfera luminosa morbida ($d = \|\text{gl\_PointCoord} - 0.5\|$, $\alpha = \text{smoothstep}(0.5, 0.08, d)$) in bianco puro `#FFFFFF` e argento `#D4D4D8` con `THREE.AdditiveBlending`.

---

## 3. CODICE COMPLETO DA IMPLEMENTARE

### 3.1 `src/components/interactive/HeroPillScrollytelling.tsx`

Crea o sostituisci questo file con l'implementazione completa della Pillola 3D e del motore particellare GLSL:

```tsx
// src/components/interactive/HeroPillScrollytelling.tsx
import React, { useRef, useState, useEffect, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, ContactShadows } from '@react-three/drei';
import * as THREE from 'three';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useStore } from '@nanostores/react';
import { animationsPausedStore } from '@/lib/stores/uiStore';

gsap.registerPlugin(ScrollTrigger);

// ============================================================================
// 1. CAMPIONATORE CANVAS 2D -> COORDINATE 3D DELLE LETTERE
// ============================================================================
function sampleTextTo3DPoints(
  lines: string[],
  maxParticles: number,
  worldWidth = 5.4,
  worldHeight = 1.9
): {
  corePositions: Float32Array;
  targetPositions: Float32Array;
  randoms: Float32Array;
  scales: Float32Array;
} {
  const corePositions = new Float32Array(maxParticles * 3);
  const targetPositions = new Float32Array(maxParticles * 3);
  const randoms = new Float32Array(maxParticles * 3);
  const scales = new Float32Array(maxParticles);

  // Fallback se eseguito in SSR
  if (typeof document === 'undefined') {
    return { corePositions, targetPositions, randoms, scales };
  }

  const canvas = document.createElement('canvas');
  const width = 1200;
  const height = 420;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  const validPixels: { x: number; y: number }[] = [];

  if (ctx) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Font bold geometrico coerente con il Design System
    const fontSize = lines.length > 1 ? 118 : 140;
    ctx.font = `700 ${fontSize}px "Inter", "Geist", -apple-system, BlinkMacSystemFont, sans-serif`;

    const lineHeight = fontSize * 1.12;
    const startY = height / 2 - ((lines.length - 1) * lineHeight) / 2;

    lines.forEach((line, idx) => {
      ctx.fillText(line.toUpperCase(), width / 2, startY + idx * lineHeight);
    });

    const imgData = ctx.getImageData(0, 0, width, height).data;
    const step = 2; // Passo di campionamento denso per lettere nitide

    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const alpha = imgData[(y * width + x) * 4];
        if (alpha > 140) {
          validPixels.push({
            x: (x / width - 0.5) * worldWidth,
            y: -(y / height - 0.5) * worldHeight,
          });
        }
      }
    }
  }

  // Mescola i pixel campionati per una distribuzione uniforme
  for (let i = validPixels.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = validPixels[i];
    validPixels[i] = validPixels[j];
    validPixels[j] = temp;
  }

  const count = validPixels.length || 1;

  for (let i = 0; i < maxParticles; i++) {
    const i3 = i * 3;

    // 1. Posizione iniziale: compressa dentro il nucleo energetico della pillola chiusa
    const u = Math.random();
    const v = Math.random();
    const theta = u * 2.0 * Math.PI;
    const phi = Math.acos(2.0 * v - 1.0);
    const r = Math.cbrt(Math.random()) * 0.28; // Raggio interno alla capsula

    corePositions[i3] = r * Math.sin(phi) * Math.cos(theta);
    corePositions[i3 + 1] = r * Math.cos(phi) * 1.45; // Leggermente allungato lungo l'asse della pillola
    corePositions[i3 + 2] = r * Math.sin(phi) * Math.sin(theta);

    // 2. Posizione target: pixel delle lettere (più un 8% di polvere atmosferica intorno al testo)
    if (i < maxParticles * 0.92 && validPixels.length > 0) {
      const px = validPixels[i % count];
      targetPositions[i3] = px.x + (Math.random() - 0.5) * 0.012;
      targetPositions[i3 + 1] = px.y + 0.32 + (Math.random() - 0.5) * 0.012; // Centrato sopra i sottotitoli/CTA
      targetPositions[i3 + 2] = (Math.random() - 0.5) * 0.04;
    } else {
      // Micro-particelle di profondità attorno alla scritta
      targetPositions[i3] = (Math.random() - 0.5) * (worldWidth * 1.25);
      targetPositions[i3 + 1] = (Math.random() - 0.5) * (worldHeight * 1.4) + 0.25;
      targetPositions[i3 + 2] = (Math.random() - 0.5) * 0.8;
    }

    // 3. Vettori di turbolenza individuale per l'esplosione dall'interno della pillola
    randoms[i3] = (Math.random() - 0.5) * 2.0;
    randoms[i3 + 1] = (Math.random() - 0.5) * 2.0;
    randoms[i3 + 2] = Math.random(); // Fase e ritardo individuale

    // 4. Dimensione variabile della particella
    scales[i] = 0.5 + Math.random() * 1.2;
  }

  return { corePositions, targetPositions, randoms, scales };
}

// ============================================================================
// 2. SHADERS GLSL CUSTOM PER LO SCIAME PARTICELLARE TIPOGRAFICO
// ============================================================================
const particleVertexShader = /* glsl */ `
  attribute vec3 aTarget;
  attribute vec3 aRandom;
  attribute float aScale;

  uniform float uTime;
  uniform float uScroll;
  uniform float uPixelRatio;
  uniform vec2 uMouse;

  varying float vAlpha;
  varying float vHighlight;

  // Funzione smoothstep sicura
  float remap(float value, float min1, float max1) {
    return clamp((value - min1) / (max1 - min1), 0.0, 1.0);
  }

  void main() {
    // Ritardo individuale basato su aRandom.z per evitare movimenti rigidi in blocco
    float delay = aRandom.z * 0.12;

    // Fase 1: Apertura pillola ed espulsione vorticosa dal nucleo (scroll 0.16 -> 0.52)
    float burstProgress = smoothstep(0.15 + delay * 0.5, 0.48 + delay * 0.5, uScroll);

    // Fase 2: Coalescenza magnetica a formare le lettere del testo (scroll 0.38 -> 0.76)
    float coalesce = smoothstep(0.36 + delay, 0.75 + delay * 0.4, uScroll);
    // Curva cubic-out per un aggancio morbido e preciso sulla lettera
    float coalesceEase = 1.0 - pow(1.0 - coalesce, 3.0);

    // Interpolazione base tra interno della pillola e posizione lettera
    vec3 pos = mix(position, aTarget, coalesceEase);

    // Calcolo inviluppo di turbolenza: massimo a metà apertura (quando escono dalla pillola), 0 quando formano il testo
    float turbulenceEnvelope = sin(burstProgress * 3.14159265) * (1.0 - coalesceEase * 0.85);

    // Spirale tridimensionale in uscita dal varco della pillola
    float angle = uTime * 1.4 + aRandom.z * 6.2831;
    vec3 swirlOffset = vec3(
      cos(angle) * aRandom.x * 1.9,
      sin(angle) * aRandom.y * 1.35,
      sin(angle * 0.8 + aRandom.x) * 1.6
    );

    pos += swirlOffset * turbulenceEnvelope;

    // Fluttuazione viva nel nucleo prima dell'apertura
    float idleCore = 1.0 - burstProgress;
    pos.x += sin(uTime * 2.2 + aRandom.z * 10.0) * 0.04 * idleCore;
    pos.y += cos(uTime * 1.8 + aRandom.x * 10.0) * 0.04 * idleCore;

    // Interazione Mouse (Repulsione elastica morbida sulle lettere formate dalle particelle)
    vec2 mouseWorld = vec2(uMouse.x * 2.8, uMouse.y * 1.6);
    float distToMouse = distance(pos.xy, mouseWorld);
    float repulsionRadius = 0.65;
    if (distToMouse < repulsionRadius && coalesceEase > 0.2) {
      float force = pow(1.0 - distToMouse / repulsionRadius, 2.0) * coalesceEase;
      vec2 dir = normalize(pos.xy - mouseWorld + vec2(0.0001));
      pos.xy += dir * force * 0.22;
      pos.z += force * 0.18;
    }

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    // Dimensione particelle: più grandi durante lo sciame, finissime e nitide quando compongono le lettere
    float sizeMultiplier = mix(1.4, 0.88, coalesceEase) + turbulenceEnvelope * 0.8;
    gl_PointSize = aScale * sizeMultiplier * uPixelRatio * (18.0 / -mvPosition.z);

    // Calcolo Alpha: visibilità ridotta dentro il vetro fumé, massima durante uscita e formazione testo,
    // poi cross-fade morbido (0.82 -> 0.94) quando subentra il testo HTML vettoriale nitido per SEO
    float coreAlpha = 0.35;
    float activeAlpha = mix(coreAlpha, 1.0, smoothstep(0.14, 0.32, uScroll));
    float handoffFade = 1.0 - smoothstep(0.80, 0.93, uScroll);

    vAlpha = activeAlpha * handoffFade;
    vHighlight = turbulenceEnvelope + coalesceEase * 0.5;
  }
`;

const particleFragmentShader = /* glsl */ `
  varying float vAlpha;
  varying float vHighlight;

  void main() {
    // Particella circolare morbida con nucleo ad alta luminanza
    float dist = length(gl_PointCoord - vec2(0.5));
    if (dist > 0.5) discard;

    float core = smoothstep(0.5, 0.05, dist);
    vec3 silverColor = vec3(0.75, 0.75, 0.78);
    vec3 pureWhite = vec3(1.0, 1.0, 1.0);
    vec3 finalColor = mix(silverColor, pureWhite, clamp(vHighlight, 0.0, 1.0));

    gl_FragColor = vec4(finalColor, core * vAlpha);
  }
`;

// ============================================================================
// 3. COMPONENTE SCENA 3D (PILLOLA + PARTICLE TYPOGRAPHY)
// ============================================================================
interface SceneProps {
  isPaused: boolean;
  mouseNorm: React.MutableRefObject<{ x: number; y: number }>;
  scrollProgress: React.MutableRefObject<number>;
}

function PillAndParticlesScene({ isPaused, mouseNorm, scrollProgress }: SceneProps) {
  const pillGroupRef = useRef<THREE.Group>(null);
  const topHalfRef = useRef<THREE.Group>(null);
  const bottomHalfRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const coreMeshRef = useRef<THREE.Mesh>(null);
  const coreMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const rimLightRef = useRef<THREE.PointLight>(null);
  const shaderMatRef = useRef<THREE.ShaderMaterial>(null);

  const [hovered, setHovered] = useState(false);
  const { gl, viewport } = useThree();

  // Adatta la larghezza della scritta 3D per schermi mobile e desktop
  const isMobile = viewport.width < 4.2;

  const particleData = useMemo(() => {
    const particleCount = isMobile ? 3200 : 5600;
    const worldW = isMobile ? Math.min(viewport.width * 0.9, 3.2) : 5.4;
    const worldH = isMobile ? 1.35 : 1.85;
    return sampleTextTo3DPoints(
      ['ARCHITETTURE', 'ZERO-LATENCY'],
      particleCount,
      worldW,
      worldH
    );
  }, [isMobile, viewport.width]);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uScroll: { value: 0 },
      uPixelRatio: { value: Math.min(gl.getPixelRatio(), 1.75) },
      uMouse: { value: new THREE.Vector2(0, 0) },
    }),
    [gl]
  );

  useEffect(() => {
    document.body.style.cursor = hovered ? 'pointer' : 'auto';
    return () => {
      document.body.style.cursor = 'auto';
    };
  }, [hovered]);

  useFrame((state, delta) => {
    if (isPaused) return;

    const dt = Math.min(delta, 0.1);
    const t = state.clock.getElapsedTime();
    const p = scrollProgress.current;

    const damp = 1 - Math.exp(-3.5 * dt);
    const fastDamp = 1 - Math.exp(-6.5 * dt);

    // 1. AGGIORNA UNIFORMS DELLO SHADER PARTICELLARE
    if (shaderMatRef.current) {
      shaderMatRef.current.uniforms.uTime.value = t;
      shaderMatRef.current.uniforms.uScroll.value = THREE.MathUtils.lerp(
        shaderMatRef.current.uniforms.uScroll.value,
        p,
        fastDamp
      );
      shaderMatRef.current.uniforms.uMouse.value.x = THREE.MathUtils.lerp(
        shaderMatRef.current.uniforms.uMouse.value.x,
        mouseNorm.current.x,
        damp
      );
      shaderMatRef.current.uniforms.uMouse.value.y = THREE.MathUtils.lerp(
        shaderMatRef.current.uniforms.uMouse.value.y,
        mouseNorm.current.y,
        damp
      );
    }

    if (!pillGroupRef.current) return;

    // 2. CINEMATICA APERTURA PILLOLA 3D
    const openPhase = THREE.MathUtils.smoothstep(p, 0.14, 0.65);
    const exitPhase = THREE.MathUtils.smoothstep(p, 0.60, 0.95);
    const hoverMicroOpen = hovered && p < 0.16 ? 0.085 : 0.0;

    // Le due calotte si aprono liberando le particelle, poi escono completamente dai bordi
    const separation = hoverMicroOpen + openPhase * 2.1 + exitPhase * 4.2;

    if (topHalfRef.current && bottomHalfRef.current) {
      topHalfRef.current.position.y = THREE.MathUtils.lerp(
        topHalfRef.current.position.y,
        separation,
        fastDamp
      );
      bottomHalfRef.current.position.y = THREE.MathUtils.lerp(
        bottomHalfRef.current.position.y,
        -separation,
        fastDamp
      );

      topHalfRef.current.rotation.y = openPhase * 0.75;
      bottomHalfRef.current.rotation.y = -openPhase * 0.75;
    }

    // Ghiera centrale e bagliore interno del nucleo
    if (ringRef.current) {
      const ringScale = Math.max(0.0001, 1 - THREE.MathUtils.smoothstep(p, 0.14, 0.34));
      ringRef.current.scale.setScalar(
        THREE.MathUtils.lerp(ringRef.current.scale.x, ringScale, fastDamp)
      );
    }

    if (coreMeshRef.current && coreMatRef.current) {
      const coreFade = 1 - THREE.MathUtils.smoothstep(p, 0.18, 0.42);
      coreMeshRef.current.scale.setScalar(Math.max(0.0001, coreFade));
      const flashIntensity = Math.sin(THREE.MathUtils.smoothstep(p, 0.12, 0.38) * Math.PI) * 3.0;
      coreMatRef.current.emissiveIntensity = (hovered ? 1.1 : 0.45) + flashIntensity;
    }

    // 3. ROTAZIONE E ALLINEAMENTO DEL GRUPPO PILLOLA
    const baseRotZ = THREE.MathUtils.lerp(-0.42, -1.45, THREE.MathUtils.smoothstep(p, 0.0, 0.38));
    const targetRotX = 0.26 + mouseNorm.current.y * 0.24 * (1 - openPhase);
    const targetRotY = -0.35 + mouseNorm.current.x * 0.34 * (1 - openPhase) + t * 0.06;
    const targetRotZ = baseRotZ + mouseNorm.current.x * -0.08;

    pillGroupRef.current.rotation.x = THREE.MathUtils.lerp(pillGroupRef.current.rotation.x, targetRotX, damp);
    pillGroupRef.current.rotation.y = THREE.MathUtils.lerp(pillGroupRef.current.rotation.y, targetRotY, damp);
    pillGroupRef.current.rotation.z = THREE.MathUtils.lerp(pillGroupRef.current.rotation.z, targetRotZ, damp);

    const floatY = Math.sin(t * 1.15) * 0.05 * (1 - openPhase);
    pillGroupRef.current.position.x = THREE.MathUtils.lerp(
      pillGroupRef.current.position.x,
      mouseNorm.current.x * 0.14 * (1 - openPhase),
      damp
    );
    pillGroupRef.current.position.y = THREE.MathUtils.lerp(
      pillGroupRef.current.position.y,
      mouseNorm.current.y * 0.12 * (1 - openPhase) + floatY,
      damp
    );

    // 4. RIFLESSO SPECULARE DINAMICO
    if (rimLightRef.current) {
      rimLightRef.current.position.x = THREE.MathUtils.lerp(
        rimLightRef.current.position.x,
        2.4 + mouseNorm.current.x * 2.2,
        damp
      );
      rimLightRef.current.position.y = THREE.MathUtils.lerp(
        rimLightRef.current.position.y,
        1.9 + mouseNorm.current.y * 2.0,
        damp
      );
    }
  });

  const radius = 0.56;
  const cylinderHeight = 0.72;

  return (
    <group>
      <pointLight ref={rimLightRef} position={[2.4, 1.9, 2.8]} intensity={22} color="#ffffff" distance={12} />

      {/* SISTEMA PARTICELLARE CHE ESCE DALLA PILLOLA E COMPONE IL TESTO */}
      <points frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={particleData.corePositions.length / 3}
            array={particleData.corePositions}
            itemSize={3}
          />
          <bufferAttribute
            attach="attributes-aTarget"
            count={particleData.targetPositions.length / 3}
            array={particleData.targetPositions}
            itemSize={3}
          />
          <bufferAttribute
            attach="attributes-aRandom"
            count={particleData.randoms.length / 3}
            array={particleData.randoms}
            itemSize={3}
          />
          <bufferAttribute
            attach="attributes-aScale"
            count={particleData.scales.length}
            array={particleData.scales}
            itemSize={1}
          />
        </bufferGeometry>
        <shaderMaterial
          ref={shaderMatRef}
          vertexShader={particleVertexShader}
          fragmentShader={particleFragmentShader}
          uniforms={uniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>

      {/* PILLOLA 3D MONOCROMATICA (VETRO FUMÉ + OSSIDIANA) */}
      <group
        ref={pillGroupRef}
        rotation={[0.26, -0.35, -0.42]}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
      >
        {/* NUCLEO ENERGETICO INTERNO */}
        <mesh ref={coreMeshRef}>
          <capsuleGeometry args={[radius * 0.44, cylinderHeight * 0.85, 24, 32]} />
          <meshStandardMaterial
            ref={coreMatRef}
            color="#ffffff"
            emissive="#ffffff"
            emissiveIntensity={0.45}
            roughness={0.15}
          />
        </mesh>

        {/* GHIERA IN TITANIO SPAZZOLATO */}
        <mesh ref={ringRef} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[radius * 0.996, 0.018, 24, 64]} />
          <meshStandardMaterial color="#f4f4f5" metalness={0.98} roughness={0.12} />
        </mesh>

        {/* CALOTTA SUPERIORE: Vetro Fumé Scuro Semitrasparente */}
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

        {/* CALOTTA INFERIORE: Ossidiana Opaca Satinata */}
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

// ============================================================================
// 4. WRAPPER PRINCIPALE + TIMELINE GSAP SCROLLTRIGGER
// ============================================================================
export default function HeroPillScrollytelling() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mouseNorm = useRef({ x: 0, y: 0 });
  const scrollProgress = useRef(0);
  const isGlobalPaused = useStore(animationsPausedStore);
  const [isInView, setIsInView] = useState(true);
  const [isReady, setIsReady] = useState(false);

  // Tracciamento mouse globale passivo
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

  // Sincronizzazione ScrollTrigger tra le particelle 3D e l'handoff del DOM HTML
  useEffect(() => {
    const wrapper = document.getElementById('hero-scrolly-wrapper');
    const stage1Text = document.getElementById('hero-stage-1');
    const stage2Headline = document.getElementById('hero-stage-2-headline');
    const stage2SubElements = gsap.utils.toArray<HTMLElement>('[data-particle-subreveal]');
    const coreGlowDom = document.getElementById('hero-core-glow');
    const scrollHint = document.getElementById('hero-scroll-hint');
    const stage2Container = document.getElementById('hero-stage-2');

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

      // 1. Dissolvenza dell'H1 iniziale mentre la pillola si prepara ad aprirsi (0.00 -> 0.20)
      if (stage1Text && scrollHint) {
        tl.to(
          [stage1Text, scrollHint],
          {
            scale: 1.06,
            opacity: 0,
            y: -24,
            ease: 'power2.inOut',
            duration: 0.2,
          },
          0
        );
      }

      // 2. Espansione del bagliore radiale durante l'uscita dello sciame di particelle (0.18 -> 0.65)
      if (coreGlowDom) {
        tl.fromTo(
          coreGlowDom,
          { scale: 0.4, opacity: 0.15 },
          { scale: 1.75, opacity: 0.42, duration: 0.35, ease: 'power2.out' },
          0.18
        ).to(coreGlowDom, { opacity: 0.16, scale: 1.2, duration: 0.35 }, 0.65);
      }

      // 3. Dal 0.20 al 0.76 le particelle 3D escono dalla pillola e compongono "ARCHITETTURE ZERO-LATENCY"
      // A 0.74 -> 0.90 eseguiamo il cross-fade con l'headline HTML nitido sovrapposto + comparsa sottotitoli e CTA
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
          0.74
        );
      }

      // 4. Rivelazione progressiva cristallina del badge, sottotitolo e bottoni CTA (0.64 -> 0.88)
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
          0.66
        );
      }
    });

    return () => ctx.revert();
  }, []);

  // Spegnimento GPU quando l'utente ha superato la Hero
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
        dpr={[1, 1.75]}
        frameloop={shouldPause ? 'demand' : 'always'}
        camera={{ position: [0, 0, 4.2], fov: 35 }}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        onCreated={() => setIsReady(true)}
      >
        <ambientLight intensity={0.45} color="#ffffff" />
        <directionalLight position={[-4, 5, 3]} intensity={2.4} color="#ffffff" />
        <directionalLight position={[4, -4, -2]} intensity={0.9} color="#a1a1aa" />

        <Environment preset="studio" environmentIntensity={0.45} />

        <PillAndParticlesScene
          isPaused={shouldPause}
          mouseNorm={mouseNorm}
          scrollProgress={scrollProgress}
        />

        <ContactShadows
          position={[0, -1.75, 0]}
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

### 3.2 `src/components/sections/HeroSection.astro`

Aggiorna `HeroSection.astro` per allineare perfettamente il nodo HTML (`#hero-stage-2-headline`) con la scritta generata dalle particelle WebGL e garantire il fallback SEO statico:

```astro
---
// src/components/sections/HeroSection.astro
import HeroPillScrollytelling from '@interactive/HeroPillScrollytelling';
---

<!-- Fallback SEO e No-JS: se JS è disattivato, tutti i testi sono visibili e indicizzabili -->
<noscript>
  <style>
    #hero-scrolly-wrapper { height: auto !important; min-height: 100vh; padding: 8rem 0; }
    #hero-stage-1, #hero-stage-2, #hero-stage-2-headline, [data-particle-subreveal] {
      opacity: 1 !important;
      transform: none !important;
      position: relative !important;
      pointer-events: auto !important;
    }
  </style>
</noscript>

<section
  id="hero-scrolly-wrapper"
  class="relative h-[360vh] w-full bg-[var(--bg-primary)] border-b border-[var(--border-subtle)]"
>
  <!-- Contenitore Sticky fissato durante i 360vh di scrollytelling -->
  <div class="sticky top-0 h-screen w-full overflow-hidden flex items-center justify-center">
    
    <!-- Bagliore centrale monocromatico modulato dall'esplosione particellare -->
    <div
      id="hero-core-glow"
      class="pointer-events-none absolute h-[380px] w-[380px] sm:h-[540px] sm:w-[540px] rounded-full blur-[130px] opacity-15 gpu-accelerated"
      style="background: radial-gradient(circle, rgba(255,255,255,0.24) 0%, rgba(255,255,255,0) 70%);"
      aria-hidden="true"
    ></div>

    <!-- LIVELLO 1 (z-10): Canvas WebGL a Tutto Schermo (Pillola 3D + Sciame Particelle Tipografiche) -->
    <div class="absolute inset-0 z-10 flex items-center justify-center">
      <HeroPillScrollytelling client:idle />
    </div>

    <!-- LIVELLO 2 (z-20): Strato Tipografico SEO & Interazione DOM -->
    <div class="relative z-20 mx-auto max-w-5xl px-6 text-center w-full flex flex-col items-center justify-center pointer-events-none">
      
      <!-- FASE 1 (0% -> 18% Scroll): Titolo Iniziale sopra la Pillola Chiusa -->
      <div id="hero-stage-1" class="flex flex-col items-center space-y-6 gpu-accelerated">
        <div class="inline-flex items-center gap-2.5 rounded-full border border-[var(--border-subtle)] bg-[#0c0c0e]/85 backdrop-blur-md px-4 py-1.5">
          <span class="h-1.5 w-1.5 rounded-full bg-white animate-pulse"></span>
          <span class="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--text-muted)]">
            NZT Solutions — Next-Gen Engineering
          </span>
        </div>

        <h1 class="text-metallic font-semibold tracking-tight text-4xl sm:text-6xl lg:text-7xl leading-[1.05] max-w-4xl">
          Sblocca il vero potenziale digitale della tua azienda.
        </h1>

        <p class="text-[var(--text-muted)] text-base sm:text-lg max-w-xl font-normal">
          Scorri per aprire il nucleo e comporre l'architettura.
        </p>
      </div>

      <!-- FASE 2 (Composta dalle particelle tra il 20% e il 75% dello scroll, poi consolidata nel DOM) -->
      <div
        id="hero-stage-2"
        class="absolute inset-x-6 flex flex-col items-center justify-center space-y-6 pointer-events-none gpu-accelerated"
      >
        <div
          data-particle-subreveal
          class="opacity-0 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/[0.04] backdrop-blur-md px-3.5 py-1"
        >
          <span class="font-mono text-xs uppercase tracking-widest text-white">
            Core Particle Synthesis Complete
          </span>
        </div>

        <!-- Questo H2 combacia con le lettere "ARCHITETTURE / ZERO-LATENCY" composte dalle particelle 3D -->
        <h2
          id="hero-stage-2-headline"
          class="opacity-0 text-metallic font-bold uppercase tracking-tight text-4xl sm:text-6xl lg:text-[4.5rem] leading-[1.05] max-w-4xl select-none"
        >
          Architetture<br />Zero-Latency
        </h2>

        <p
          data-particle-subreveal
          class="opacity-0 text-[var(--text-muted)] text-base sm:text-xl leading-relaxed max-w-2xl font-normal pt-2"
        >
          Software su misura, ecosistemi web ad altissima velocità e posizionamento SEO nativo progettati per dominare il tuo mercato.
        </p>

        <div
          data-particle-subreveal
          class="opacity-0 flex flex-wrap items-center justify-center gap-4 pt-3"
        >
          <a
            href="#contatti"
            class="inline-flex items-center justify-center rounded-lg bg-white px-7 py-3.5 text-sm font-medium text-[#050505] shadow-[0_0_30px_rgba(255,255,255,0.22)] transition-all duration-300 hover:bg-zinc-200 hover:-translate-y-0.5"
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

    <!-- Indicatore di Scroll Minimalista -->
    <div
      id="hero-scroll-hint"
      class="pointer-events-none absolute bottom-8 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-2"
    >
      <span class="font-mono text-[10px] uppercase tracking-[0.25em] text-[var(--text-subtle)]">
        Scroll to Synthesize
      </span>
      <div class="h-9 w-[1px] bg-gradient-to-b from-white/50 to-transparent"></div>
    </div>

  </div>
</section>
```

---

## 4. CHECKLIST DI VERIFICA PER CLAUDE DOPO L'IMPLEMENTAZIONE

1. **Verifica Allineamento Particelle $\leftrightarrow$ Testo:** Controlla che durante lo scroll tra il $20\%$ e il $75\%$ le particelle escano visibilmente dal centro della pillola aperta, formino nitidamente le due righe `"ARCHITETTURE"` e `"ZERO-LATENCY"`, e che al $75\%\text{-}90\%$ dello scroll avvenga il passaggio fluido al testo HTML e ai bottoni CTA cliccabili.
2. **Verifica Reattività al Mouse:** Passando il cursore sulle lettere formate dalle particelle, verifica che lo shader applichi la micro-repulsione elastica (`uMouse`) dando una sensazione viva e interattiva.
3. **Verifica Performance GPU:** Assicurati che scorrendo oltre la Hero Section (`#hero-scrolly-wrapper`), `IntersectionObserver` imposti `frameloop="demand"` sul `<Canvas>` fermando completamente i calcoli dello shader mentre l'utente legge il resto del sito.