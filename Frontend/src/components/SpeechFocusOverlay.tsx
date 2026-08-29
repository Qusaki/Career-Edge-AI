import React from 'react';
import { Mic } from 'lucide-react';

export type SpeechFocusOverlayProps = {
  isOpen: boolean;
  liveTranscript: string;
  onStop: () => void;
};

export function SpeechFocusOverlay({
  isOpen,
  onStop,
}: SpeechFocusOverlayProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center overflow-hidden p-4"
      role="group"
      aria-label="Active microphone"
    >
      <div className="absolute inset-0 bg-slate-950/30 backdrop-blur-sm" aria-hidden="true" />

      <div className="relative flex max-w-full flex-col items-center text-center text-white">
        <button
          type="button"
          onClick={onStop}
          className="relative flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500 text-white shadow-[0_12px_35px_rgba(16,185,129,0.35)] transition-colors hover:bg-emerald-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
          aria-label="Stop microphone"
          title="Stop microphone"
        >
          <Mic className="relative z-10 h-9 w-9" aria-hidden="true" />
          <span className="absolute inset-0 animate-ping rounded-full border-2 border-emerald-300 opacity-25" aria-hidden="true" />
        </button>

        <div className="mt-4" aria-live="polite">
          <p className="text-base font-bold tracking-tight drop-shadow-sm">
            Listening...
          </p>
          <p className="mt-1 text-sm font-medium text-slate-200 drop-shadow-sm">
            You can speak now
          </p>
        </div>
      </div>
    </div>
  );
}
