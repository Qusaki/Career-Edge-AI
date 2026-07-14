import { useEffect, useRef, useState } from 'react';

type DetectedFace = { boundingBox: { x: number; y: number; width: number; height: number } };

export function useEyeContactTracker(enabled: boolean) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [score, setScore] = useState(0);
  const [samples, setSamples] = useState(0);
  const [status, setStatus] = useState<'off' | 'starting' | 'tracking' | 'unsupported' | 'blocked'>('off');
  const hitsRef = useRef(0);
  const samplesRef = useRef(0);

  useEffect(() => {
    if (!enabled) { setStatus('off'); return; }
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;
    hitsRef.current = 0;
    samplesRef.current = 0;
    setScore(0); setSamples(0); setStatus('starting');

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
        if (cancelled) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
        const FaceDetectorCtor = (window as any).FaceDetector;
        if (!FaceDetectorCtor) { setStatus('unsupported'); return; }
        const detector = new FaceDetectorCtor({ fastMode: true, maxDetectedFaces: 1 });
        setStatus('tracking');
        timer = setInterval(async () => {
          const video = videoRef.current;
          if (!video || video.readyState < 2) return;
          try {
            const face = ((await detector.detect(video)) as DetectedFace[])[0];
            samplesRef.current += 1;
            if (face) {
              const box = face.boundingBox;
              const centeredX = Math.abs(box.x + box.width / 2 - video.videoWidth / 2) <= video.videoWidth * 0.22;
              const centeredY = Math.abs(box.y + box.height / 2 - video.videoHeight / 2) <= video.videoHeight * 0.25;
              if (centeredX && centeredY && box.width >= video.videoWidth * 0.16) hitsRef.current += 1;
            }
            setSamples(samplesRef.current);
            setScore(Math.round((hitsRef.current / samplesRef.current) * 100));
          } catch { /* Continue after an individual detection failure. */ }
        }, 750);
      } catch { setStatus('blocked'); }
    };
    void start();
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach(track => track.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [enabled]);

  return { videoRef, score, samples, status };
}
