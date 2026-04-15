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
  const headBoneRef = useRef<THREE.Object3D | null>(null);
  const neckBoneRef = useRef<THREE.Object3D | null>(null);
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

      // --- MULTI-MESH DETECTION & BONE TRACKING ---
      const detectedMeshes: THREE.Mesh[] = [];
      scene.traverse((child: any) => {
        if (child.isBone) {
          if (child.name.includes('Head') || child.name === 'J_Bip_C_Head') {
            headBoneRef.current = child;
            if (!child.userData.initRot) child.userData.initRot = child.rotation.clone();
          }
          if (child.name.includes('Neck') || child.name === 'J_Bip_C_Neck') {
            neckBoneRef.current = child;
            if (!child.userData.initRot) child.userData.initRot = child.rotation.clone();
          }
        }
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

    // Reset core mouth shapes to ensure mutual exclusivity
    const syncMorphs = ['mouth-a', 'mouth-wa', 'mouth-o', 'mouth-u', 'mouth-e', 'mouth-ch', 'tongue-lower'];
    syncMorphs.forEach(m => targetMorphs[m] = 0);

    let usedRhubarb = false;

    // --- 1. RHUBARB LIP SYNC (Perfect Word-by-Word Mapping) ---
    if (mouthCues && mouthCues.length > 0 && audioContext && currentAudioTime !== undefined && isSpeaking) {
      // Find the precise offset into the currently playing audio chunk
      const elapsed = audioContext.currentTime - currentAudioTime;
      const currentCue = mouthCues.find(c => elapsed >= c.start && elapsed <= c.end);
      
      if (currentCue) {
        usedRhubarb = true;
        const val = currentCue.value;
        // Map Rhubarb Visemes to our specific structural morphs
        if (val === 'B') {
           targetMorphs['mouth-e'] = 0.35; // Slightly open (K, S, T)
        } else if (val === 'C') {
           targetMorphs['mouth-a'] = 0.25; // Open mouth (EH, AH)
        } else if (val === 'D') {
           targetMorphs['mouth-a'] = 0.45; // Wide open (AA)
           targetMorphs['mouth-wa'] = 0.05;
        } else if (val === 'E') {
           targetMorphs['mouth-o'] = 0.5;  // Rounded (O)
        } else if (val === 'F') {
           targetMorphs['mouth-u'] = 0.5;  // Puckered (U)
        } else if (val === 'G') {
           targetMorphs['mouth-ch'] = 0.4; // F, V (Teeth)
        } else if (val === 'H') {
           targetMorphs['mouth-a'] = 0.15; // L (Tongue)
           targetMorphs['tongue-lower'] = 0.3;
        }
      }
    }

    // --- 2. FALLBACK OVERRIDE: 'WINNER TAKES ALL' SPECTRAL ---
    // If Rhubarb isn't available for this chunk, use a strictly exclusive spectral fallback
    if (!usedRhubarb && isSpeaking && analyserNode) {
      if (!dataArrayRef.current || dataArrayRef.current.length !== analyserNode.frequencyBinCount) {
        dataArrayRef.current = new Uint8Array(analyserNode.frequencyBinCount);
      }
      analyserNode.getByteFrequencyData(dataArrayRef.current as any);

      let low = 0; let midO = 0; let midE = 0; let high = 0;
      for (let i = 1; i <= 4; i++) low += dataArrayRef.current[i] || 0;
      for (let i = 5; i <= 14; i++) midO += dataArrayRef.current[i] || 0;
      for (let i = 15; i <= 30; i++) midE += dataArrayRef.current[i] || 0;
      for (let i = 31; i <= 60; i++) high += dataArrayRef.current[i] || 0;

      const lowLevel = Math.min(1.0, low / (4 * 200)); 
      const midOLevel = Math.min(1.0, midO / (10 * 180));
      const midELevel = Math.min(1.0, midE / (16 * 160));
      const highLevel = Math.min(1.0, high / (30 * 120));

      const volume = (lowLevel + midOLevel + midELevel) / 3;

      if (volume > 0.05) {
        const intensity = Math.min(0.4, volume * 1.5);
        const maxVal = Math.max(lowLevel, midOLevel, midELevel, highLevel);

        if (maxVal === highLevel && highLevel > 0.2) {
          targetMorphs['mouth-ch'] = intensity;
        } else if (maxVal === midOLevel && midOLevel > lowLevel * 0.8) {
          targetMorphs['mouth-o'] = intensity;
        } else if (maxVal === midELevel) {
          targetMorphs['mouth-e'] = intensity;
        } else {
          targetMorphs['mouth-a'] = intensity;
          targetMorphs['tongue-lower'] = intensity * 0.2;
        }
      }
    }

    // --- EMOTIONAL KEYS ---
    if (isSpeaking) {
      targetMorphs['mouth-slight-smile'] = 0.25;
      targetMorphs['brows-cheerful'] = 0.35;
      targetMorphs['misc-blush'] = 0.3;
      targetMorphs['brows-upper'] = usedRhubarb ? 0.2 : 0.4;
    } else {
      // Friendly, attentive expression when listening
      targetMorphs['mouth-slight-smile'] = 0.15; 
      targetMorphs['brows-cheerful'] = 0.2;
      targetMorphs['misc-blush'] = 0.05;
      targetMorphs['brows-upper'] = 0.05;
    }

    // --- AUTO-BLINK LOGIC ---
    const currentTime = state.clock.elapsedTime;
    if (currentTime > nextBlinkTimeRef.current) {
      blinkRef.current = 1; 
      nextBlinkTimeRef.current = currentTime + 2 + Math.random() * 6;
    }
    blinkRef.current += (0 - blinkRef.current) * 0.15;

    // --- PROCEDURAL HEAD & NECK ANIMATION (ORGANIC & PUNCTUATED) ---
    let targetHeadRotX = 0;
    let targetHeadRotY = 0;
    let targetHeadRotZ = 0;
    let targetNeckRotX = 0;
    let targetNeckRotY = 0;

    // Sum up the current wide mouth morphs to detect syllable intensity.
    const speechIntensity = (targetMorphs['mouth-a'] || 0) + (targetMorphs['mouth-e'] || 0) + (targetMorphs['mouth-o'] || 0) + (targetMorphs['mouth-u'] || 0);
    
    // Smooth the energy over time to prevent robotic jittering
    smoothMouthRef.current += (speechIntensity - smoothMouthRef.current) * 0.08;
    const energy = smoothMouthRef.current;

    if (isSpeaking || energy > 0.05) {
      // Organic, slow sweeping motion that scales with speaking energy
      // This prevents the "unreal staring" while keeping movement purposeful
      targetHeadRotX = Math.sin(currentTime * 1.5) * 0.02 * energy; 
      targetHeadRotY = Math.sin(currentTime * 0.8) * 0.04 * energy;
      targetHeadRotZ = Math.cos(currentTime * 1.2) * 0.015 * energy;
      
      // Tiny direct punctuation exactly on the syllables (very soft, no jitter)
      targetHeadRotX += speechIntensity * 0.02; 
      targetNeckRotX = speechIntensity * 0.01; 
      
      // Look slightly to the sides during strong speaking
      targetNeckRotY = Math.sin(currentTime * 0.5) * 0.015 * energy;
    } else {
      // Almost completely still when idle, simulating organic postural breathing
      targetHeadRotX = Math.sin(currentTime * 0.4) * 0.005;
      targetHeadRotY = Math.sin(currentTime * 0.2) * 0.003;
    }

    // Apply baseline-relative rotations directly to bones with a highly smoothed lerp
    if (headBoneRef.current && headBoneRef.current.userData.initRot) {
       const init = headBoneRef.current.userData.initRot;
       // Dropped the lerp factor to 0.05 to soften the movements organically
       headBoneRef.current.rotation.x += ((init.x + targetHeadRotX) - headBoneRef.current.rotation.x) * 0.05;
       headBoneRef.current.rotation.y += ((init.y + targetHeadRotY) - headBoneRef.current.rotation.y) * 0.05;
       headBoneRef.current.rotation.z += ((init.z + targetHeadRotZ) - headBoneRef.current.rotation.z) * 0.05;
    }
    
    if (neckBoneRef.current && neckBoneRef.current.userData.initRot) {
       const init = neckBoneRef.current.userData.initRot;
       neckBoneRef.current.rotation.x += ((init.x + targetNeckRotX) - neckBoneRef.current.rotation.x) * 0.1;
       neckBoneRef.current.rotation.y += ((init.y + targetNeckRotY) - neckBoneRef.current.rotation.y) * 0.1;
    }

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
          const isBrow = targetName.includes('brows');
          const isStructural = targetName.includes('tongue');
          
          // CRITICAL FIX: All mouth phonemes must share the exact same lerpFactor!
          // If 'mouth-o' fades at 0.2 and 'mouth-a' fades at 0.1, the 'O' shape will artificially stick. 
          const isMouthPhoneme = targetName.startsWith('mouth-') && !isSmile;
          
          if (isMouthPhoneme) {
             lerpFactor = 0.3; // Snappy shared rate for all speech shapes
          } else if (isStructural || isBrow) {
             lerpFactor = 0.1;
          } else if (isSmile) {
             lerpFactor = 0.08;
          } else {
             lerpFactor = 0.2;
          }
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
