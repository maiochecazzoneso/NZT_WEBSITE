// src/components/interactive/HeroPillScrollytelling.tsx
// v2.1: solo la scena 3D. La timeline DOM (testi, bagliore, hint, navbar) è in src/lib/hero-scroll.ts, così un
// errore WebGL non tocca i contenuti; l'ambiente luminoso è procedurale (Lightformer): 0 byte scaricati.
import React, { useRef, useState, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
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

    const totalSeparation = hoverMicroOpen + scrollOpenProgress * 1.85 + flyOutProgress * 3.8;

    if (topHalfRef.current && bottomHalfRef.current) {
      topHalfRef.current.position.y = THREE.MathUtils.lerp(
        topHalfRef.current.position.y,
        totalSeparation,
        fastDamp,
      );
      bottomHalfRef.current.position.y = THREE.MathUtils.lerp(
        bottomHalfRef.current.position.y,
        -totalSeparation,
        fastDamp,
      );

      // Leggera rotazione opposta delle due calotte mentre si aprono
      topHalfRef.current.rotation.y = scrollOpenProgress * 0.6;
      bottomHalfRef.current.rotation.y = -scrollOpenProgress * 0.6;
    }

    // 2. SCALA E SCOMPARSA DELLA GHIERA E DEL NUCLEO INTERNO
    if (ringRef.current) {
      const ringScale = Math.max(0.001, 1 - THREE.MathUtils.smoothstep(p, 0.18, 0.45));
      ringRef.current.scale.setScalar(
        THREE.MathUtils.lerp(ringRef.current.scale.x, ringScale, fastDamp),
      );
    }

    if (coreMeshRef.current && coreMatRef.current) {
      // Il nucleo brilla quando la pillola inizia ad aprirsi, poi svanisce per lasciare spazio al testo HTML
      const coreFadeOut = 1 - THREE.MathUtils.smoothstep(p, 0.32, 0.55);
      const targetCoreScale = (1 + scrollOpenProgress * 0.4) * Math.max(0.001, coreFadeOut);
      coreMeshRef.current.scale.setScalar(
        THREE.MathUtils.lerp(coreMeshRef.current.scale.x, targetCoreScale, fastDamp),
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

    rootGroupRef.current.rotation.x = THREE.MathUtils.lerp(
      rootGroupRef.current.rotation.x,
      targetRotX,
      damp,
    );
    rootGroupRef.current.rotation.y = THREE.MathUtils.lerp(
      rootGroupRef.current.rotation.y,
      targetRotY,
      damp,
    );
    rootGroupRef.current.rotation.z = THREE.MathUtils.lerp(
      rootGroupRef.current.rotation.z,
      targetRotZ,
      damp,
    );

    // Fluttuazione idle + effetto zoom/fly-through finale
    const floatY = Math.sin(t * 1.1) * 0.05 * (1 - scrollOpenProgress);
    const targetPosX = mouseNorm.current.x * 0.15 * (1 - scrollOpenProgress);
    const targetPosY = mouseNorm.current.y * 0.12 * (1 - scrollOpenProgress) + floatY;
    const targetPosZ = flyOutProgress * 1.8; // Avanza verso la camera in uscita

    rootGroupRef.current.position.x = THREE.MathUtils.lerp(
      rootGroupRef.current.position.x,
      targetPosX,
      damp,
    );
    rootGroupRef.current.position.y = THREE.MathUtils.lerp(
      rootGroupRef.current.position.y,
      targetPosY,
      damp,
    );
    rootGroupRef.current.position.z = THREE.MathUtils.lerp(
      rootGroupRef.current.position.z,
      targetPosZ,
      damp,
    );

    // 4. LUCE SPECULARE CHE SEGUE IL MOUSE
    if (rimLightRef.current) {
      rimLightRef.current.position.x = THREE.MathUtils.lerp(
        rimLightRef.current.position.x,
        2.2 + mouseNorm.current.x * 2.0,
        damp,
      );
      rimLightRef.current.position.y = THREE.MathUtils.lerp(
        rimLightRef.current.position.y,
        1.8 + mouseNorm.current.y * 2.0,
        damp,
      );
    }
  });

  const radius = 0.58;
  const cylinderHeight = 0.74;

  return (
    <group>
      <pointLight
        ref={rimLightRef}
        position={[2.2, 1.8, 2.8]}
        intensity={20}
        color="#ffffff"
        distance={12}
      />

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

  // 2. Progresso di scroll della Hero per useFrame: ScrollTrigger dedicato, solo onUpdate (nessun tween DOM).
  // Stessi trigger/start/end della v2.0 → stesso self.progress grezzo (non smussato dallo scrub).
  useEffect(() => {
    const wrapper = document.getElementById('hero-scrolly-wrapper');
    if (!wrapper) return;

    const trigger = ScrollTrigger.create({
      trigger: wrapper,
      start: 'top top',
      end: 'bottom bottom',
      onUpdate: (self) => {
        scrollProgress.current = self.progress;
      },
    });
    scrollProgress.current = trigger.progress;

    return () => trigger.kill();
  }, []);

  // 3. Spegnimento automatico WebGL quando la Hero esce dallo schermo
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
          dpr={[1, 1.5]}
          frameloop={shouldPause ? 'demand' : 'always'}
          camera={{ position: [0, 0, 4.0], fov: 35 }}
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
      </CanvasErrorBoundary>
    </div>
  );
}
