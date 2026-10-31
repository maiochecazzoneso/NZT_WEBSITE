// src/components/interactive/HeroPillScrollytelling.tsx
// v3.0 particle-to-text: pillola 3D + sciame di particelle GLSL che esce dal nucleo e compone l'headline della Hero.
// La timeline DOM (hint, bagliore, handoff dell'h2, sottotitolo/CTA, navbar) è in src/lib/hero-scroll.ts, così un
// errore WebGL non tocca i contenuti; l'ambiente luminoso è procedurale (Lightformer): 0 byte scaricati.
import React, { useRef, useState, useEffect, useMemo } from 'react';
import { Canvas, useFrame, useThree, invalidate } from '@react-three/fiber';
import { Environment, Lightformer, ContactShadows } from '@react-three/drei';
import * as THREE from 'three';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useStore } from '@nanostores/react';
import { animationsPausedStore } from '@/lib/stores/uiStore';

gsap.registerPlugin(ScrollTrigger);

// Se WebGL non è disponibile o la scena lancia un errore, r3f lo rilancia fuori dal <Canvas>: qui viene
// intercettato e la scena sparisce in silenzio (il contenitore resta a opacity 0), senza smontare l'isola.
class CanvasErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

// ============================================================================
// 1. CAMPIONATORE CANVAS 2D -> COORDINATE 3D DELLE LETTERE
// ============================================================================
// Le lettere di particelle devono cadere esattamente sotto l'h2 HTML (#hero-stage-2-headline) che subentra
// nell'handoff. Invece di un riquadro world fisso, il testo viene disegnato con font, peso, interlinea e
// letter-spacing calcolati dell'h2 e ogni pixel viene proiettato sul piano z = 0 della camera usando il riquadro
// dell'h2 dentro il canvas WebGL: allineamento corretto a ogni viewport (ricampionato al resize).
const HEADLINE_ID = 'hero-stage-2-headline';
// Densità di campionamento: testo disegnato a 90 px (spec: 118 px), un pixel ogni 2. A 90 px i pixel pieni sono
// ~9 200 (> 5 600 particelle): costo sul main thread ~40 ms invece di ~50 ms con CPU 4× più lenta (~12 ms desktop)
const SAMPLE_FONT_PX = 90;
const SAMPLE_STEP = 2;
// uMouse senza un mouse reale: campo di repulsione fuori dallo schermo
const NO_MOUSE = 100;

interface HeadlineLayout {
  lines: string[];
  fontWeight: string;
  fontFamily: string;
  fontSize: number; // px CSS
  letterSpacing: number; // px CSS
  lineHeight: number; // px CSS
  width: number; // riquadro dell'h2 senza la scala GSAP (px CSS)
  height: number;
  centerX: number; // centro dell'h2 sul piano z = 0 (unità world)
  centerY: number;
  worldPerPx: number;
}

function measureHeadline(
  headline: HTMLElement,
  canvas: HTMLElement,
  viewportHeight: number,
): HeadlineLayout | null {
  const cs = getComputedStyle(headline);
  const box = canvas.getBoundingClientRect();
  const rect = headline.getBoundingClientRect();
  const lines = headline.innerText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (!box.height || !rect.width || lines.length === 0) return null;

  const fontSize = parseFloat(cs.fontSize);
  const worldPerPx = viewportHeight / box.height;
  return {
    lines,
    fontWeight: cs.fontWeight,
    fontFamily: cs.fontFamily,
    fontSize,
    letterSpacing: parseFloat(cs.letterSpacing) || 0,
    lineHeight: parseFloat(cs.lineHeight) || fontSize * 1.05,
    // La scala GSAP (0.98 -> 1, origine al centro) non sposta il centro; offsetWidth/Height la ignorano
    width: headline.offsetWidth,
    height: headline.offsetHeight,
    centerX: (rect.left + rect.width / 2 - (box.left + box.width / 2)) * worldPerPx,
    centerY: -(rect.top + rect.height / 2 - (box.top + box.height / 2)) * worldPerPx,
    worldPerPx,
  };
}

function sampleTextTo3DPoints(
  layout: HeadlineLayout,
  maxParticles: number,
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

  // Canvas offscreen con le proporzioni esatte dell'h2, scalato per avere glifi di SAMPLE_FONT_PX
  const k = SAMPLE_FONT_PX / layout.fontSize;
  const width = Math.ceil(layout.width * k);
  const height = Math.ceil(layout.height * k);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const validPixels: { x: number; y: number }[] = [];
  const worldWidth = layout.width * layout.worldPerPx;
  const worldHeight = layout.height * layout.worldPerPx;

  if (ctx) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    // Stesso font dell'h2 (Geist Sans, peso calcolato: il bold è sintetizzato come nel DOM)
    ctx.font = `${layout.fontWeight} ${SAMPLE_FONT_PX}px ${layout.fontFamily}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${layout.letterSpacing * k}px`;

    // Modello CSS: area di contenuto (ascent + descent del font) centrata in ogni riga (half-leading)
    const metrics = ctx.measureText('H');
    const ascent = metrics.fontBoundingBoxAscent || SAMPLE_FONT_PX * 0.9;
    const descent = metrics.fontBoundingBoxDescent || SAMPLE_FONT_PX * 0.22;
    const lineHeight = layout.lineHeight * k;

    layout.lines.forEach((line, idx) => {
      const baseline = idx * lineHeight + (lineHeight - (ascent + descent)) / 2 + ascent;
      ctx.fillText(line.toUpperCase(), width / 2, baseline);
    });

    const imgData = ctx.getImageData(0, 0, width, height).data;

    for (let y = 0; y < height; y += SAMPLE_STEP) {
      for (let x = 0; x < width; x += SAMPLE_STEP) {
        const alpha = imgData[(y * width + x) * 4];
        if (alpha > 140) {
          validPixels.push({
            x: layout.centerX + (x / k - layout.width / 2) * layout.worldPerPx,
            y: layout.centerY - (y / k - layout.height / 2) * layout.worldPerPx,
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
      targetPositions[i3 + 1] = px.y + (Math.random() - 0.5) * 0.012;
      targetPositions[i3 + 2] = (Math.random() - 0.5) * 0.04;
    } else {
      // Micro-particelle di profondità attorno alla scritta
      targetPositions[i3] = layout.centerX + (Math.random() - 0.5) * (worldWidth * 1.25);
      targetPositions[i3 + 1] = layout.centerY + (Math.random() - 0.5) * (worldHeight * 1.4);
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
  uniform vec2 uMouseScale;
  uniform float uFade;

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
    // uMouseScale = metà del viewport world sul piano z = 0: il campo segue il cursore a ogni formato
    vec2 mouseWorld = uMouse * uMouseScale;
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
    // poi cross-fade morbido (0.80 -> 0.93) quando subentra il testo HTML vettoriale nitido per SEO
    float coreAlpha = 0.35;
    float activeAlpha = mix(coreAlpha, 1.0, smoothstep(0.14, 0.32, uScroll));
    float handoffFade = 1.0 - smoothstep(0.80, 0.93, uScroll);

    // uFade: dissolvenza del livello in pausa (scena congelata), 1 durante l'animazione
    vAlpha = activeAlpha * handoffFade * uFade;
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
  mouseNorm: React.MutableRefObject<{ x: number; y: number; mouse: boolean }>;
  scrollProgress: React.MutableRefObject<number>;
}

type ParticleData = ReturnType<typeof sampleTextTo3DPoints> & { id: number };

function PillAndParticlesScene({ isPaused, mouseNorm, scrollProgress }: SceneProps) {
  const pillGroupRef = useRef<THREE.Group>(null);
  const topHalfRef = useRef<THREE.Group>(null);
  const bottomHalfRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const coreMeshRef = useRef<THREE.Mesh>(null);
  const coreMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const rimLightRef = useRef<THREE.PointLight>(null);
  const shaderMatRef = useRef<THREE.ShaderMaterial>(null);
  // Rotazione lenta (0.06 rad/s) accumulata solo a pillola chiusa
  const spinRef = useRef(0);

  const [hovered, setHovered] = useState(false);
  const [particleData, setParticleData] = useState<ParticleData | null>(null);
  const gl = useThree((state) => state.gl);
  const size = useThree((state) => state.size);
  const viewport = useThree((state) => state.viewport);

  // Numero di particelle per schermi mobile e desktop
  const isMobile = viewport.width < 4.2;
  const particleCount = isMobile ? 3200 : 5600;

  // Campionamento dopo il caricamento del font dell'h2 (il canvas 2D userebbe altrimenti il font di fallback) e a
  // ogni cambio di dimensione del canvas (breakpoint dell'h2, rotazione del telefono)
  useEffect(() => {
    const headline = document.getElementById(HEADLINE_ID);
    if (!headline) return;
    let cancelled = false;
    const cs = getComputedStyle(headline);
    const sample = () => {
      const layout = measureHeadline(headline, gl.domElement, viewport.height);
      if (cancelled || !layout) return;
      setParticleData((prev) => ({
        ...sampleTextTo3DPoints(layout, particleCount),
        id: (prev?.id ?? 0) + 1,
      }));
    };
    document.fonts.load(`${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`).then(sample, sample);
    return () => {
      cancelled = true;
    };
  }, [gl, size.width, size.height, viewport.height, particleCount]);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uScroll: { value: 0 },
      uPixelRatio: { value: Math.min(gl.getPixelRatio(), 1.75) },
      uMouse: { value: new THREE.Vector2(NO_MOUSE, NO_MOUSE) },
      uMouseScale: { value: new THREE.Vector2(1, 1) },
      uFade: { value: 1 },
    }),
    [gl],
  );

  useEffect(() => {
    document.body.style.cursor = hovered ? 'pointer' : 'auto';
    return () => {
      document.body.style.cursor = 'auto';
    };
  }, [hovered]);

  useFrame((state, delta) => {
    const p = scrollProgress.current;

    if (isPaused) {
      // Scena congelata (reduced motion, pausa utente, fuori vista): nessun movimento, ma il livello particellare si
      // dissolve quando subentra l'headline HTML, così non resta a metà sopra/sotto il testo DOM. In frameloop
      // "demand" il frame viene richiesto dallo ScrollTrigger dell'isola (invalidate).
      if (shaderMatRef.current) {
        shaderMatRef.current.uniforms.uFade.value = 1 - THREE.MathUtils.smoothstep(p, 0.8, 0.93);
      }
      return;
    }

    const dt = Math.min(delta, 0.1);
    const t = state.clock.getElapsedTime();

    const damp = 1 - Math.exp(-3.5 * dt);
    const fastDamp = 1 - Math.exp(-6.5 * dt);

    // 1. AGGIORNA UNIFORMS DELLO SHADER PARTICELLARE
    if (shaderMatRef.current) {
      shaderMatRef.current.uniforms.uFade.value = 1;
      shaderMatRef.current.uniforms.uMouseScale.value.set(
        state.viewport.width / 2,
        state.viewport.height / 2,
      );
      shaderMatRef.current.uniforms.uTime.value = t;
      shaderMatRef.current.uniforms.uScroll.value = THREE.MathUtils.lerp(
        shaderMatRef.current.uniforms.uScroll.value,
        p,
        fastDamp,
      );
      // Repulsione solo con un mouse reale: su touch (o con il cursore mai mosso) il campo resterebbe fisso al
      // centro dello schermo o sull'ultimo tocco e scaverebbe un buco permanente nelle lettere
      const mouseUniform = shaderMatRef.current.uniforms.uMouse.value;
      if (!mouseNorm.current.mouse) {
        mouseUniform.set(NO_MOUSE, NO_MOUSE);
      } else if (mouseUniform.x === NO_MOUSE) {
        mouseUniform.set(mouseNorm.current.x, mouseNorm.current.y);
      } else {
        mouseUniform.x = THREE.MathUtils.lerp(mouseUniform.x, mouseNorm.current.x, damp);
        mouseUniform.y = THREE.MathUtils.lerp(mouseUniform.y, mouseNorm.current.y, damp);
      }
    }

    if (!pillGroupRef.current) return;

    // 2. CINEMATICA APERTURA PILLOLA 3D
    const openPhase = THREE.MathUtils.smoothstep(p, 0.14, 0.65);
    const exitPhase = THREE.MathUtils.smoothstep(p, 0.6, 0.95);
    const hoverMicroOpen = hovered && p < 0.16 ? 0.085 : 0.0;

    // Le due calotte si aprono liberando le particelle, poi escono completamente dai bordi
    const separation = hoverMicroOpen + openPhase * 2.1 + exitPhase * 4.2;

    if (topHalfRef.current && bottomHalfRef.current) {
      topHalfRef.current.position.y = THREE.MathUtils.lerp(
        topHalfRef.current.position.y,
        separation,
        fastDamp,
      );
      bottomHalfRef.current.position.y = THREE.MathUtils.lerp(
        bottomHalfRef.current.position.y,
        -separation,
        fastDamp,
      );

      topHalfRef.current.rotation.y = openPhase * 0.75;
      bottomHalfRef.current.rotation.y = -openPhase * 0.75;
    }

    // Ghiera centrale e bagliore interno del nucleo
    if (ringRef.current) {
      const ringScale = Math.max(0.0001, 1 - THREE.MathUtils.smoothstep(p, 0.14, 0.34));
      ringRef.current.scale.setScalar(
        THREE.MathUtils.lerp(ringRef.current.scale.x, ringScale, fastDamp),
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
    // La rotazione lenta si ferma all'inizio dell'apertura e si allinea al multiplo di π più vicino: l'asse di
    // separazione resta sul piano dello schermo e le calotte escono dai bordi (con t * 0.06 non limitato, dopo
    // ~25 s di pagina l'asse ruotava in profondità e una calotta restava a metà schermo dietro l'headline)
    if (openPhase === 0) spinRef.current += dt * 0.06;
    const spin = THREE.MathUtils.lerp(
      spinRef.current,
      Math.round(spinRef.current / Math.PI) * Math.PI,
      openPhase,
    );
    const targetRotY = -0.35 + mouseNorm.current.x * 0.34 * (1 - openPhase) + spin;
    const targetRotZ = baseRotZ + mouseNorm.current.x * -0.08;

    pillGroupRef.current.rotation.x = THREE.MathUtils.lerp(
      pillGroupRef.current.rotation.x,
      targetRotX,
      damp,
    );
    pillGroupRef.current.rotation.y = THREE.MathUtils.lerp(
      pillGroupRef.current.rotation.y,
      targetRotY,
      damp,
    );
    pillGroupRef.current.rotation.z = THREE.MathUtils.lerp(
      pillGroupRef.current.rotation.z,
      targetRotZ,
      damp,
    );

    const floatY = Math.sin(t * 1.15) * 0.05 * (1 - openPhase);
    pillGroupRef.current.position.x = THREE.MathUtils.lerp(
      pillGroupRef.current.position.x,
      mouseNorm.current.x * 0.14 * (1 - openPhase),
      damp,
    );
    pillGroupRef.current.position.y = THREE.MathUtils.lerp(
      pillGroupRef.current.position.y,
      mouseNorm.current.y * 0.12 * (1 - openPhase) + floatY,
      damp,
    );

    // 4. RIFLESSO SPECULARE DINAMICO
    if (rimLightRef.current) {
      rimLightRef.current.position.x = THREE.MathUtils.lerp(
        rimLightRef.current.position.x,
        2.4 + mouseNorm.current.x * 2.2,
        damp,
      );
      rimLightRef.current.position.y = THREE.MathUtils.lerp(
        rimLightRef.current.position.y,
        1.9 + mouseNorm.current.y * 2.0,
        damp,
      );
    }
  });

  const radius = 0.56;
  const cylinderHeight = 0.72;

  return (
    <group>
      <pointLight
        ref={rimLightRef}
        position={[2.4, 1.9, 2.8]}
        intensity={22}
        color="#ffffff"
        distance={12}
      />

      {/* SISTEMA PARTICELLARE CHE ESCE DALLA PILLOLA E COMPONE IL TESTO (dopo il campionamento dell'h2) */}
      {particleData && (
        <points key={particleData.id} frustumCulled={false}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[particleData.corePositions, 3]} />
            <bufferAttribute attach="attributes-aTarget" args={[particleData.targetPositions, 3]} />
            <bufferAttribute attach="attributes-aRandom" args={[particleData.randoms, 3]} />
            <bufferAttribute attach="attributes-aScale" args={[particleData.scales, 1]} />
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
      )}

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
        {/* NUCLEO ENERGETICO INTERNO (nucleo e vetro senza depthWrite: le particelle dello Stato 1, dentro il nucleo,
            restano visibili attraverso la calotta in vetro fumé; l'ossidiana opaca continua a nasconderle) */}
        <mesh ref={coreMeshRef}>
          <capsuleGeometry args={[radius * 0.44, cylinderHeight * 0.85, 24, 32]} />
          <meshStandardMaterial
            ref={coreMatRef}
            color="#ffffff"
            emissive="#ffffff"
            emissiveIntensity={0.45}
            roughness={0.15}
            depthWrite={false}
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
              depthWrite={false}
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
              depthWrite={false}
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
// 4. WRAPPER PRINCIPALE (progresso di scroll, mouse, pausa GPU)
// ============================================================================
export default function HeroPillScrollytelling() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mouseNorm = useRef({ x: 0, y: 0, mouse: false });
  const scrollProgress = useRef(0);
  const isGlobalPaused = useStore(animationsPausedStore);
  const [isInView, setIsInView] = useState(true);
  const [isReady, setIsReady] = useState(false);

  // 1. Tracciamento mouse globale passivo
  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      mouseNorm.current = {
        x: (e.clientX / window.innerWidth) * 2 - 1,
        y: -(e.clientY / window.innerHeight) * 2 + 1,
        mouse: e.pointerType === 'mouse',
      };
    };
    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    return () => window.removeEventListener('pointermove', handlePointerMove);
  }, []);

  // 2. Progresso di scroll della Hero per useFrame: ScrollTrigger dedicato, solo onUpdate (nessun tween DOM).
  // Stessi trigger/start/end della timeline DOM → stesso self.progress grezzo (non smussato dallo scrub).
  // invalidate(): con la scena in pausa (frameloop "demand") ridisegna un frame per la dissolvenza del livello
  // particellare all'handoff; con frameloop "always" non ha effetto.
  useEffect(() => {
    const wrapper = document.getElementById('hero-scrolly-wrapper');
    if (!wrapper) return;

    const trigger = ScrollTrigger.create({
      trigger: wrapper,
      start: 'top top',
      end: 'bottom bottom',
      onUpdate: (self) => {
        scrollProgress.current = self.progress;
        invalidate();
      },
    });
    scrollProgress.current = trigger.progress;

    return () => trigger.kill();
  }, []);

  // 3. Spegnimento GPU quando l'utente ha superato la Hero
  useEffect(() => {
    const wrapper = document.getElementById('hero-scrolly-wrapper');
    if (!wrapper) return;
    const observer = new IntersectionObserver(([entry]) => setIsInView(entry.isIntersecting), {
      threshold: 0.01,
    });
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
      <CanvasErrorBoundary>
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

          {/* Studio procedurale monocromatico (key / fill / rim / top + rimbalzo dal basso): nessun file HDR */}
          <Environment resolution={256} environmentIntensity={0.45}>
            <color attach="background" args={['#52525b']} />
            <Lightformer form="rect" intensity={6} position={[-3, 2.5, 3]} scale={[4, 3, 1]} />
            <Lightformer form="rect" intensity={2} position={[4, 0.5, 1.5]} scale={[2.5, 5, 1]} />
            <Lightformer form="rect" intensity={3} position={[0, 1.5, -4]} scale={[7, 1.2, 1]} />
            <Lightformer form="rect" intensity={3} position={[0, 5, -0.5]} scale={[5, 5, 1]} />
            <Lightformer form="circle" intensity={0.6} position={[0, -4, 0]} scale={[6, 6, 1]} />
          </Environment>

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
      </CanvasErrorBoundary>
    </div>
  );
}
