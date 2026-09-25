import { useEffect, useRef, useState } from 'react';

type TrackerStatus = 'off' | 'starting' | 'tracking' | 'unavailable' | 'blocked';
type FaceLandmark = { x: number; y: number; z?: number };
type FaceLandmarker = {
  detectForVideo: (
    video: HTMLVideoElement,
    timestamp: number,
  ) => { faceLandmarks: FaceLandmark[][] };
};

let faceLandmarkerPromise: Promise<FaceLandmarker> | null = null;

const publicAssetUrl = (path: string) => `${import.meta.env.BASE_URL}${path}`;

const loadFaceLandmarker = (): Promise<FaceLandmarker> => {
  if (faceLandmarkerPromise) return faceLandmarkerPromise;

  faceLandmarkerPromise = (async () => {
    const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
    const vision = await FilesetResolver.forVisionTasks(publicAssetUrl('mediapipe/wasm'));
    return FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: publicAssetUrl('mediapipe/models/face_landmarker.task'),
        delegate: 'CPU',
      },
      runningMode: 'VIDEO',
      numFaces: 1,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    }) as Promise<FaceLandmarker>;
  })().catch(error => {
    // Allow a later interview to retry after a temporary model-loading failure.
    faceLandmarkerPromise = null;
    throw error;
  });

  return faceLandmarkerPromise;
};

const irisIsCentered = (
  landmarks: FaceLandmark[],
  irisIndex: number,
  firstCornerIndex: number,
  secondCornerIndex: number,
): boolean => {
  const iris = landmarks[irisIndex];
  const firstCorner = landmarks[firstCornerIndex];
  const secondCorner = landmarks[secondCornerIndex];
  if (!iris || !firstCorner || !secondCorner) return true;

  const minimumX = Math.min(firstCorner.x, secondCorner.x);
  const eyeWidth = Math.abs(firstCorner.x - secondCorner.x);
  if (eyeWidth < 0.001) return false;
  const horizontalPosition = (iris.x - minimumX) / eyeWidth;
  return horizontalPosition >= 0.25 && horizontalPosition <= 0.75;
};

/**
 * Uses face position, head direction, and both iris positions. This is still an
 * estimate of camera attention, but it is substantially closer to eye contact
 * than the previous face-bounding-box-only calculation.
 */
export const isLookingAtCamera = (landmarks: FaceLandmark[]): boolean => {
  if (landmarks.length < 264) return false;

  const leftEyeOuter = landmarks[33];
  const rightEyeOuter = landmarks[263];
  const noseTip = landmarks[1];
  if (!leftEyeOuter || !rightEyeOuter || !noseTip) return false;

  const xs = landmarks.map(point => point.x);
  const ys = landmarks.map(point => point.y);
  const minimumX = Math.min(...xs);
  const maximumX = Math.max(...xs);
  const minimumY = Math.min(...ys);
  const maximumY = Math.max(...ys);
  const faceWidth = maximumX - minimumX;
  const faceHeight = maximumY - minimumY;
  const faceCenterX = (minimumX + maximumX) / 2;
  const faceCenterY = (minimumY + maximumY) / 2;

  const eyeDistance = Math.hypot(
    rightEyeOuter.x - leftEyeOuter.x,
    rightEyeOuter.y - leftEyeOuter.y,
  );
  const eyeMidpointX = (leftEyeOuter.x + rightEyeOuter.x) / 2;
  const eyesAreLevel = Math.abs(leftEyeOuter.y - rightEyeOuter.y) <= eyeDistance * 0.22;
  const headFacesCamera = Math.abs(noseTip.x - eyeMidpointX) <= eyeDistance * 0.20;
  const faceIsVisibleAndCentered = faceWidth >= 0.16
    && faceHeight >= 0.20
    && Math.abs(faceCenterX - 0.5) <= 0.24
    && Math.abs(faceCenterY - 0.5) <= 0.28;

  // MediaPipe iris centers: 468 (right) and 473 (left).
  const rightIrisCentered = irisIsCentered(landmarks, 468, 33, 133);
  const leftIrisCentered = irisIsCentered(landmarks, 473, 362, 263);

  return faceIsVisibleAndCentered
    && eyesAreLevel
    && headFacesCamera
    && rightIrisCentered
    && leftIrisCentered;
};

// A detector invocation is not a measurement unless it found a usable face.
// A valid face looking away still counts and can produce a genuine 0% score.
export const hasTrackableFace = (landmarks: FaceLandmark[] | undefined): landmarks is FaceLandmark[] => {
  if (!landmarks || landmarks.length < 264) return false;
  return landmarks.every(point =>
    point && Number.isFinite(point.x) && Number.isFinite(point.y)
  );
};

export type EyeContactCounters = { hits: number; samples: number };

export const countEyeContactFrame = (
  previous: EyeContactCounters,
  landmarks: FaceLandmark[] | undefined,
): EyeContactCounters => {
  if (!hasTrackableFace(landmarks)) return previous;
  return {
    hits: previous.hits + (isLookingAtCamera(landmarks) ? 1 : 0),
    samples: previous.samples + 1,
  };
};

export function useEyeContactTracker(enabled: boolean) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [score, setScore] = useState(0);
  const [samples, setSamples] = useState(0);
  const [status, setStatus] = useState<TrackerStatus>('off');
  const hitsRef = useRef(0);
  const samplesRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setStatus('off');
      return;
    }

    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;
    hitsRef.current = 0;
    samplesRef.current = 0;
    setScore(0);
    setSamples(0);
    setStatus('starting');

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
          audio: false,
        });
      } catch (error) {
        const errorName = error instanceof DOMException ? error.name : '';
        setStatus(['NotAllowedError', 'SecurityError'].includes(errorName) ? 'blocked' : 'unavailable');
        return;
      }

      if (cancelled) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }

      const cameraTrack = stream.getVideoTracks()[0];
      if (cameraTrack) cameraTrack.onended = () => {
        if (cancelled) return;
        if (timer) clearInterval(timer);
        timer = null;
        setStatus('unavailable');
      };

      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach(track => track.stop());
        setStatus('unavailable');
        return;
      }

      try {
        video.srcObject = stream;
        await video.play();
        const landmarker = await loadFaceLandmarker();
        if (cancelled || cameraTrack?.readyState === 'ended') return;

        setStatus('tracking');
        timer = setInterval(() => {
          if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth <= 0 || video.videoHeight <= 0) return;
          try {
            const result = landmarker.detectForVideo(video, performance.now());
            const next = countEyeContactFrame(
              { hits: hitsRef.current, samples: samplesRef.current },
              result.faceLandmarks[0],
            );
            if (next.samples === samplesRef.current) return;
            hitsRef.current = next.hits;
            samplesRef.current = next.samples;
            setSamples(samplesRef.current);
            setScore(Math.round((hitsRef.current / samplesRef.current) * 100));
          } catch (error) {
            console.warn('Eye-contact frame detection failed:', error);
          }
        }, 750);
      } catch (error) {
        console.error('Eye-contact tracker failed to initialize:', error);
        stream?.getTracks().forEach(track => track.stop());
        video.srcObject = null;
        setStatus('unavailable');
      }
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
