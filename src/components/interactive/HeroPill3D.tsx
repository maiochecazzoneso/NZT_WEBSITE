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

    groupRef.current.rotation.x = THREE.MathUtils.lerp(
      groupRef.current.rotation.x,
      targetRotX,
      damp,
    );
    groupRef.current.rotation.y = THREE.MathUtils.lerp(
      groupRef.current.rotation.y,
      targetRotY,
      damp,
    );
    groupRef.current.rotation.z = THREE.MathUtils.lerp(
      groupRef.current.rotation.z,
      targetRotZ,
      damp,
    );

    // 2. Micro-spostamento parallasse (molto contenuto)
    const targetPosX = mouseNorm.current.x * 0.18;
    const targetPosY = mouseNorm.current.y * 0.14 + Math.sin(t * 1.1) * 0.06;

    groupRef.current.position.x = THREE.MathUtils.lerp(
      groupRef.current.position.x,
      targetPosX,
      damp,
    );
    groupRef.current.position.y = THREE.MathUtils.lerp(
      groupRef.current.position.y,
      targetPosY,
      damp,
    );

    // 3. Micro-apertura longitudinale della capsula in stato di Hover (sobria: 0.065 unità)
    const separationOffset = hovered ? 0.065 : 0.0;
    if (topHalfRef.current && bottomHalfRef.current) {
      topHalfRef.current.position.y = THREE.MathUtils.lerp(
        topHalfRef.current.position.y,
        separationOffset,
        microDamp,
      );
      bottomHalfRef.current.position.y = THREE.MathUtils.lerp(
        bottomHalfRef.current.position.y,
        -separationOffset,
        microDamp,
      );
    }

    // 4. Modulazione dell'intensità luminosa del nucleo interno in Hover
    if (coreMaterialRef.current) {
      const targetEmissive = hovered ? 0.85 : 0.28 + Math.sin(t * 1.8) * 0.06;
      coreMaterialRef.current.emissiveIntensity = THREE.MathUtils.lerp(
        coreMaterialRef.current.emissiveIntensity,
        targetEmissive,
        microDamp,
      );
    }

    // 5. Spostamento dinamico del riflesso speculare con il mouse
    if (rimLightRef.current) {
      rimLightRef.current.position.x = THREE.MathUtils.lerp(
        rimLightRef.current.position.x,
        2.5 + mouseNorm.current.x * 1.8,
        damp,
      );
      rimLightRef.current.position.y = THREE.MathUtils.lerp(
        rimLightRef.current.position.y,
        2.0 + mouseNorm.current.y * 1.8,
        damp,
      );
    }
  });

  const radius = 0.56;
  const cylinderHeight = 0.72;

  return (
    <group>
      {/* Luce speculare dinamica che segue dolcemente il mouse */}
      <pointLight
        ref={rimLightRef}
        position={[2.5, 2.0, 2.5]}
        intensity={18}
        color="#ffffff"
        distance={10}
      />

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
            <meshStandardMaterial color="#e4e4e7" metalness={0.96} roughness={0.18} />
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
    const observer = new IntersectionObserver(([entry]) => setIsInView(entry.isIntersecting), {
      threshold: 0.05,
    });
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
