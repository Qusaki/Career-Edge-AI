import React from 'react';
import { Mic, Square } from 'lucide-react';

export type SpeechFocusOverlayProps = {
  isOpen: boolean;
  liveTranscript: string;
  onStop: () => void;
};

export function SpeechFocusOverlay({
  isOpen,
  liveTranscript,
  onStop,
}: SpeechFocusOverlayProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center overflow-y-auto p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="speech-focus-title"
      aria-describedby="speech-focus-instruction"
    >
      <div className="absolute inset-0 bg-slate-950/55 backdrop-blur-[4px]" aria-hidden="true" />

      <section className="relative my-auto max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-3xl border border-white/15 bg-slate-900/95 p-6 text-center text-white shadow-2xl sm:p-8">
        <div className="program-accent-interview-active relative mx-auto flex h-20 w-20 items-center justify-center rounded-full shadow-lg">
          <Mic className="relative z-10 h-9 w-9" aria-hidden="true" />
          <span className="absolute inset-0 animate-ping rounded-full border-2 border-current opacity-30" aria-hidden="true" />
        </div>

        <h2 id="speech-focus-title" className="mt-5 text-2xl font-bold tracking-tight">
          Listening...
        </h2>
        <p id="speech-focus-instruction" className="mt-1 text-sm font-medium text-slate-300">
          You can speak now
        </p>

        <div
          className="mt-5 min-h-28 rounded-2xl border border-white/10 bg-slate-950/55 p-4 text-left text-sm leading-relaxed text-slate-100 shadow-inner sm:text-base"
          aria-live="polite"
          aria-label="Live speech transcript"
        >
          <p className="whitespace-pre-wrap break-words">
            {liveTranscript || <span className="text-slate-400">Your words will appear here as you speak.</span>}
          </p>
        </div>

        <button
          type="button"
          onClick={onStop}
          className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-rose-600 px-6 py-3 font-bold text-white transition-colors hover:bg-rose-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:w-auto sm:min-w-44"
          aria-label="Stop listening"
        >
          <Square className="h-4 w-4 fill-current" aria-hidden="true" />
          Stop listening
        </button>
      </section>
    </div>
  );
}
