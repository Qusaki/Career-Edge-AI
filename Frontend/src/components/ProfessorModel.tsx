import React, { useRef, useEffect } from 'react';
import { useGLTF, Center } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface ProfessorModelProps {
  isSpeaking: boolean;
  analyserNode?: AnalyserNode | null;
  mouthCues?: any[] | null;
  currentAudioTime?: number;
  audioContext?: AudioContext | null;
  [key: string]: any;
}

export function ProfessorModel({
  isSpeaking,
  analyserNode,
  mouthCues,
  currentAudioTime = 0,
  audioContext,
  ...props
}: ProfessorModelProps) {
  const groupRef = useRef<THREE.Group>(null);
  const modelWrapperRef = useRef<THREE.Group>(null);
  const smoothMouthRef = useRef(0);
  const dataArrayRef = useRef<Uint8Array | null>(null);

  // Load the model scene directly
  const { scene } = useGLTF('/professor.glb') as any;

  // References for synchronized multi-mesh lip sync
  const headMeshesRef = useRef<THREE.Mesh[]>([]);
  const blinkRef = useRef(0);
  const nextBlinkTimeRef = useRef(0);

  // 1. Auto-center and Scale logic
  useEffect(() => {
    if (scene) {
      // Calculate bounding box and scale for framing
      const box = new THREE.Box3().setFromObject(scene);
      const size = new THREE.Vector3();
      box.getSize(size);
      const center = new THREE.Vector3();
      box.getCenter(center);
      const scaleFactor = 6.5 / size.y;

      if (modelWrapperRef.current) {
        modelWrapperRef.current.scale.setScalar(scaleFactor);
        modelWrapperRef.current.position.x = -center.x * scaleFactor;
        modelWrapperRef.current.position.y = (-center.y * scaleFactor) - 2.6;
        modelWrapperRef.current.position.z = -center.z * scaleFactor;
      }

      // --- MULTI-MESH DETECTION ---
      const detectedMeshes: THREE.Mesh[] = [];
      scene.traverse((child: any) => {
        if (child.isMesh && child.morphTargetDictionary) {
          const mouthKeys = [
            'mouth-a', 'mouth-o', 'mouth-u', 'mouth-e', 'mouth-ch', 
            'vrc.v_aa', 'mouthOpen', 'Ah', 'jawOpen', 'viseme_AA'
          ];
          const hasMouthMorphs = mouthKeys.some(key => child.morphTargetDictionary[key] !== undefined);
          if (hasMouthMorphs) {
            detectedMeshes.push(child);
          }
        }
      });
      headMeshesRef.current = detectedMeshes;
      console.log(`[ProfessorModel] Synchronizing ${detectedMeshes.length} head parts for lip sync.`);
    }
  }, [scene]);

  useFrame((state) => {
    if (!headMeshesRef.current.length) return;

    let targetMorphs: any = {};

    // --- ADVANCED SPECTRAL ANALYSIS ---
    if (isSpeaking && analyserNode) {
      if (!dataArrayRef.current || dataArrayRef.current.length !== analyserNode.frequencyBinCount) {
        dataArrayRef.current = new Uint8Array(analyserNode.frequencyBinCount);
      }
      analyserNode.getByteFrequencyData(dataArrayRef.current as any);

      // Analyze spectral bands
      let low = 0; let midO = 0; let midE = 0; let high = 0;
      for (let i = 1; i <= 4; i++) low += dataArrayRef.current[i] || 0;
      for (let i = 5; i <= 12; i++) midO += dataArrayRef.current[i] || 0;
      for (let i = 13; i <= 28; i++) midE += dataArrayRef.current[i] || 0;
      for (let i = 29; i <= 60; i++) high += dataArrayRef.current[i] || 0;

      // --- FACIAL PERSONALITY calibration ---
      const lowLevel = low / (4 * 350); 
      const midELevel = midE / (16 * 180);

      // --- EMOTIONAL KEYS ---
      targetMorphs['mouth-slight-smile'] = isSpeaking ? 0.35 : 0;
      targetMorphs['mouth-grin'] = (midELevel * 0.4) + (isSpeaking ? 0.1 : 0);
      
      // Vertical caps (Strict 25%)
      targetMorphs['mouth-a'] = Math.min(0.20, (lowLevel * 0.4) + (midELevel * 0.05));
      targetMorphs['mouth-wa'] = Math.min(0.25, targetMorphs['mouth-a'] * 1.1); 
      targetMorphs['mouth-o'] = Math.min(0.08, (midO / (8 * 800)));
      
      // Pure Facial Expression (No body movement)
      targetMorphs['brows-upper'] = lowLevel * 0.7; // Lift brows with energy
      targetMorphs['brows-cheerful'] = isSpeaking ? 0.3 : 0;
      targetMorphs['misc-blush'] = isSpeaking ? 0.25 : 0; 

      targetMorphs['tongue-lower'] = targetMorphs['mouth-a'] * 0.1; 
    }

    // --- AUTO-BLINK LOGIC ---
    const currentTime = state.clock.elapsedTime;
    if (currentTime > nextBlinkTimeRef.current) {
      blinkRef.current = 1; 
      nextBlinkTimeRef.current = currentTime + 2 + Math.random() * 6;
    }
    blinkRef.current += (0 - blinkRef.current) * 0.15;

    // --- SYNCHRONIZED MASTER ANIMATION ---
    headMeshesRef.current.forEach(mesh => {
      const dict = mesh.morphTargetDictionary!;
      const influences = mesh.morphTargetInfluences!;

      const trackedTargets = [
        'mouth-a', 'mouth-wa', 'mouth-wa2', 'mouth-wa3', 
        'mouth-o', 'mouth-u', 'mouth-e', 'mouth-e2', 'mouth-e3', 
        'mouth-ch', 'mouth-ch2', 'mouth-ch3',
        'mouth-slight-smile', 'mouth-grin', 'tongue-lower',
        'brows-upper', 'brows-cheerful', 'misc-blush', 'eyes-blink-happy'
      ];
      
      trackedTargets.forEach(targetName => {
        const index = dict[targetName];
        if (index === undefined) return;

        let targetValue = 0;
        let lerpFactor = 0.2;

        if (targetName === 'eyes-blink-happy') {
          targetValue = blinkRef.current > 0.1 ? 1.0 : 0;
          lerpFactor = 0.4;
        } else {
          const baseName = targetName.split('2')[0].split('3')[0];
          targetValue = targetMorphs[baseName] || 0;
          const clampedValue = Math.max(0, Math.min(1, targetValue));
          targetValue = clampedValue;
          
          // Smiles and grins are more persistent (0.08) for friendliness
          const isSmile = targetName.includes('smile') || targetName.includes('grin');
          const isStructural = targetName.includes('mouth-a') || targetName.includes('brows') || targetName.includes('tongue');
          lerpFactor = isStructural ? 0.1 : (isSmile ? 0.08 : 0.2);
        }
        
        influences[index] += (targetValue - influences[index]) * lerpFactor;
      });
    });
  });

  return (
    <group {...props} dispose={null}>
      <group ref={groupRef}>
        <group ref={modelWrapperRef}>
          <primitive object={scene} />
        </group>
      </group>
    </group>
  );
}

useGLTF.preload('/professor.glb');
