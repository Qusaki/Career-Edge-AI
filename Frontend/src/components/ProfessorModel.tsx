import React, { useRef, useEffect } from 'react';
import { useGLTF, Center } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface ProfessorModelProps {
  isSpeaking: boolean;
  analyserNode?: AnalyserNode | null;
  [key: string]: any;
}

export function ProfessorModel({
  isSpeaking,
  analyserNode,
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

  // Pre-calculate animation to avoid heavy logic in render loop
  useFrame((state) => {
    const t = state.clock.elapsedTime;

    let rawMouth = 0;
    if (isSpeaking && analyserNode) {
      if (!dataArrayRef.current || dataArrayRef.current.length !== analyserNode.frequencyBinCount) {
        dataArrayRef.current = new Uint8Array(analyserNode.frequencyBinCount);
      }
      analyserNode.getByteFrequencyData(dataArrayRef.current as any);

      let sum = 0;
      const bins = Math.min(dataArrayRef.current.length, 12);
      for (let i = 1; i < bins; i++) {
        sum += dataArrayRef.current[i];
      }
      rawMouth = Math.min(sum / (bins * 120), 1.0);
    }

    const targetMouth = isSpeaking ? Math.max(rawMouth, 0.35) : 0;
    smoothMouthRef.current += (targetMouth - smoothMouthRef.current) * 0.25;
    const v = smoothMouthRef.current;

    // Apply true lip sync via morph targets
    if (headMeshRef.current && mouthMorphIndexRef.current !== -1) {
      if (headMeshRef.current.morphTargetInfluences) {
        headMeshRef.current.morphTargetInfluences[mouthMorphIndexRef.current] = v;
      }
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
