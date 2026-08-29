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
        title: 'Camera active',
        detail: samples > 0 ? `Eye-contact score: ${score}%` : 'Detecting your face...',
        colors: 'border-emerald-500/35 bg-emerald-50 text-emerald-800',
      }
    : status === 'blocked'
      ? {
          icon: <CameraOff className="h-4 w-4" />,
          title: 'Camera unavailable',
          detail: 'Activity can continue without eye-contact scoring.',
          colors: 'border-rose-400/40 bg-rose-50 text-rose-800',
        }
      : status === 'unavailable'
        ? {
            icon: <CameraOff className="h-4 w-4" />,
            title: 'Camera unavailable',
            detail: 'Activity can continue without eye-contact scoring.',
            colors: 'border-rose-400/40 bg-rose-50 text-rose-800',
          }
        : {
            icon: <LoaderCircle className="h-4 w-4 animate-spin" />,
            title: 'Opening camera',
            detail: 'Preparing eye-contact tracking.',
            colors: 'border-amber-400/50 bg-amber-50 text-amber-900',
          };

  return (
    <aside
      role="status"
      aria-live="polite"
      className={`w-full max-w-40 shrink-0 overflow-hidden rounded-xl border shadow-sm ${presentation.colors}`}
    >
      <video
        ref={videoRef}
        muted
        playsInline
        className="aspect-video w-full scale-x-[-1] bg-black object-cover"
      />
      <div className="p-2.5">
        <div className="flex items-center gap-1.5 text-[11px] font-bold leading-tight">
          {presentation.icon}
          <span>{presentation.title}</span>
        </div>
        <p className="mt-1 text-[10px] leading-snug opacity-85">{presentation.detail}</p>
      </div>
    </aside>
  );
}
