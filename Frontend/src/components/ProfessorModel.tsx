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

  // References for dynamic lip sync blendshapes
  const headMeshRef = useRef<THREE.Mesh | null>(null);
  const mouthMorphIndexRef = useRef<number>(-1);

  // 1. Auto-center and Scale logic
  useEffect(() => {
    if (scene) {
      // Calculate bounding box
      const box = new THREE.Box3().setFromObject(scene);
      const size = new THREE.Vector3();
      box.getSize(size);
      const center = new THREE.Vector3();
      box.getCenter(center);

      // Balance the zoom level to show both the full head and the chest
      const scaleFactor = 6.5 / size.y;

      if (modelWrapperRef.current) {
        modelWrapperRef.current.scale.setScalar(scaleFactor);
        // Position it to frame the upper body balanced in the center
        modelWrapperRef.current.position.x = -center.x * scaleFactor;
        modelWrapperRef.current.position.y = (-center.y * scaleFactor) - 2.6;
        modelWrapperRef.current.position.z = -center.z * scaleFactor;
      }

      // Find morph targets (blendshapes)
      scene.traverse((child: any) => {
        if (child.isMesh && child.morphTargetDictionary) {
          const possibleNames = [
            'mouth-a', 'mouth-o', 'mouth-u', 'mouth-e', 'mouth-ch',
            'vrc.v_aa', 'mouthOpen', 'MouthOpen', 'jawOpen', 'A', 'a', 'ah', 'Ah'
          ];
          for (const name of possibleNames) {
            if (child.morphTargetDictionary[name] !== undefined) {
              headMeshRef.current = child;
              mouthMorphIndexRef.current = child.morphTargetDictionary[name];
              break;
            }
          }
        }
      });
    }
  }, [scene]);

  useFrame(() => {
    if (!headMeshRef.current || !headMeshRef.current.morphTargetDictionary || !headMeshRef.current.morphTargetInfluences) return;

    const dict = headMeshRef.current.morphTargetDictionary;
    const influences = headMeshRef.current.morphTargetInfluences;

    let targetMorphs: any = {};

    // --- ADVANCED SPECTRAL ANALYSIS (Frontend Only) ---
    if (isSpeaking && analyserNode) {
      if (!dataArrayRef.current || dataArrayRef.current.length !== analyserNode.frequencyBinCount) {
        dataArrayRef.current = new Uint8Array(analyserNode.frequencyBinCount);
      }
      analyserNode.getByteFrequencyData(dataArrayRef.current as any);

      // We analyze frequency energy across surgical bands
      let low = 0;   // 0-400Hz (Jaw movement / Ah)
      let midO = 0;  // 400-1100Hz (O, U shapes)
      let midE = 0;  // 1100-2600Hz (E, I shapes)
      let high = 0;  // 2600Hz+ (Fricatives, S, T, Ch)

      for (let i = 1; i <= 4; i++) low += dataArrayRef.current[i] || 0;
      for (let i = 5; i <= 12; i++) midO += dataArrayRef.current[i] || 0;
      for (let i = 13; i <= 28; i++) midE += dataArrayRef.current[i] || 0;
      for (let i = 29; i <= 60; i++) high += dataArrayRef.current[i] || 0;

      // Normalize levels (0.0 to 1.0)
      const lowLevel = low / (4 * 255);
      const midOLevel = midO / (8 * 255);
      const midELevel = midE / (16 * 255);
      const highLevel = high / (32 * 255);

      // Drive morph targets with mathematical curves for natural movement
      targetMorphs['mouth-a'] = Math.pow(lowLevel, 0.7) * 1.3;
      targetMorphs['mouth-o'] = Math.pow(midOLevel, 1.1) * 1.5;
      targetMorphs['mouth-e'] = Math.pow(midELevel, 1.0) * 1.2;
      targetMorphs['mouth-u'] = (midOLevel * 0.8) + (lowLevel * 0.3);
      targetMorphs['mouth-ch'] = highLevel * 0.9;

      // Smoothing & Minimum thresholds
      if (lowLevel > 0.04) {
        targetMorphs['mouth-a'] = Math.max(targetMorphs['mouth-a'], 0.2);
      } else {
        targetMorphs['mouth-a'] = 0;
      }
    }

    // --- INTERPOLATION & APPLICATION ---
    const trackedTargets = ['mouth-a', 'mouth-o', 'mouth-u', 'mouth-e', 'mouth-ch'];
    trackedTargets.forEach(targetName => {
      const index = dict[targetName];
      if (index !== undefined) {
        const targetValue = targetMorphs[targetName] || 0;
        const clampedValue = Math.max(0, Math.min(1, targetValue));
        
        // Attack is fast (0.4), decay is gentle (0.15) for fluid speech
        const lerpFactor = clampedValue > influences[index] ? 0.4 : 0.15;
        influences[index] += (clampedValue - influences[index]) * lerpFactor;
      }
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
