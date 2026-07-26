import type { RefObject } from 'react';
import { Camera, CameraOff, LoaderCircle } from 'lucide-react';

type CameraTrackingNoticeProps = {
  videoRef: RefObject<HTMLVideoElement | null>;
  status: 'off' | 'starting' | 'tracking' | 'unavailable' | 'blocked';
  score: number;
  samples: number;
};

export function CameraTrackingNotice({
  videoRef,
  status,
  score,
  samples,
}: CameraTrackingNoticeProps) {
  const presentation = status === 'tracking'
    ? {
        icon: <Camera className="h-4 w-4" />,
        title: 'Camera tracking active',
        detail: 'Eye direction and head movement are being evaluated.',
        colors: 'border-emerald-500/40 bg-emerald-50 text-emerald-800',
      }
    : status === 'blocked'
      ? {
          icon: <CameraOff className="h-4 w-4" />,
          title: 'Camera access blocked',
          detail: 'Allow camera access in your browser, then reopen the activity.',
          colors: 'border-rose-400/50 bg-rose-50 text-rose-800',
        }
      : status === 'unavailable'
        ? {
            icon: <CameraOff className="h-4 w-4" />,
            title: 'Camera tracking unavailable',
            detail: 'The activity can continue, but camera movement will not be scored.',
            colors: 'border-rose-400/50 bg-rose-50 text-rose-800',
          }
        : {
            icon: <LoaderCircle className="h-4 w-4 animate-spin" />,
            title: 'Opening camera',
            detail: 'The system is requesting camera access for eye and movement tracking.',
            colors: 'border-amber-400/60 bg-amber-50 text-amber-900',
          };

  return (
    <aside
      role="status"
      aria-live="polite"
      className={`fixed right-4 top-20 z-[90] w-[min(19rem,calc(100vw-2rem))] rounded-xl border p-3 shadow-xl ${presentation.colors}`}
    >
      <div className="flex gap-3">
        <video
          ref={videoRef}
          muted
          playsInline
          className="h-16 w-20 shrink-0 scale-x-[-1] rounded-lg bg-black object-cover"
        />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-bold">
            {presentation.icon}
            <span>{presentation.title}</span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed opacity-85">{presentation.detail}</p>
          {status === 'tracking' && (
            <p className="mt-1 text-[10px] font-semibold">
              {samples > 0 ? `Current camera score: ${score}%` : 'Detecting your face...'}
            </p>
          )}
        </div>
      </div>
    </aside>
  );
}
