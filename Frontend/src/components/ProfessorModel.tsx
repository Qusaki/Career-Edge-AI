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

  // 1. Phoneme to Morph Mapping
  const PHONEME_MAP: any = {
    A: { 'mouth-a': 0.2 }, // Closed/Almost closed
    B: { 'mouth-a': 0.4 }, // M, P, B
    C: { 'mouth-e': 0.8 }, // E, AE
    D: { 'mouth-a': 1.0 }, // I, AI
    E: { 'mouth-o': 0.8 }, // O, AW
    F: { 'mouth-u': 0.8 }, // U, OW
    G: { 'mouth-ch': 0.6 }, // F, V
    H: { 'mouth-ch': 0.4 }, // L, N, T
    X: {},                 // Silence
  };

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    let targetMorphs: any = {};

    // 2. High-Fidelity Rhubarb Lip Sync (If cues are provided)
    if (isSpeaking && mouthCues && mouthCues.length > 0 && currentAudioTime > 0 && audioContext) {
      // Use the master audio hardware clock for perfect synchronization
      const elapsed = audioContext.currentTime - currentAudioTime;
      const currentCue = mouthCues.find(cue => elapsed >= cue.start && elapsed <= cue.end);
      if (currentCue) {
        targetMorphs = PHONEME_MAP[currentCue.value] || {};
      }
    } 
    // 3. Fallback: Audio Amplitude Lip Sync
    else if (isSpeaking && analyserNode) {
      if (!dataArrayRef.current || dataArrayRef.current.length !== analyserNode.frequencyBinCount) {
        dataArrayRef.current = new Uint8Array(analyserNode.frequencyBinCount);
      }
      analyserNode.getByteFrequencyData(dataArrayRef.current as any);

      let sum = 0;
      const bins = Math.min(dataArrayRef.current.length, 12);
      for (let i = 1; i < bins; i++) {
        sum += dataArrayRef.current[i];
      }
      const rawMouth = Math.min(sum / (bins * 100), 1.0);
      const intensity = Math.max(rawMouth, 0.35);
      targetMorphs = { 'mouth-a': intensity };
    }

    // 4. Smoothing and Application
    if (headMeshRef.current && headMeshRef.current.morphTargetDictionary && headMeshRef.current.morphTargetInfluences) {
      const dict = headMeshRef.current.morphTargetDictionary;
      const influences = headMeshRef.current.morphTargetInfluences;

      // We smoothly interpolate each tracked morph target
      const trackedTargets = ['mouth-a', 'mouth-o', 'mouth-u', 'mouth-e', 'mouth-ch'];
      trackedTargets.forEach(targetName => {
        const index = dict[targetName];
        if (index !== undefined) {
          const targetValue = targetMorphs[targetName] || 0;
          // Smooth Lerp
          influences[index] += (targetValue - influences[index]) * 0.25;
        }
      });
    }
  });

  return (
    <group {...props} dispose={null}>
      {/* Outer group for rotations */}
      <group ref={groupRef}>
        {/* Inner wrapper for auto-scaling and centering offsets */}
        <group ref={modelWrapperRef}>
          <primitive object={scene} />
        </group>
      </group>
    </group>
  );
}

useGLTF.preload('/professor.glb');
