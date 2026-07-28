import React from 'react';
import { Volume2 } from 'lucide-react';

export function SoundWaveInterviewer({ active, label }: { active: boolean; label: string }) {
  const bars = [28, 46, 68, 40, 84, 52, 72, 34, 58, 44, 76, 36];

  return (
    <div className="flex min-h-56 flex-col items-center justify-center gap-5 rounded-lg border border-line bg-background p-6 text-center">
      <div className="flex h-28 items-center gap-2">
        {bars.map((height, index) => (
          <span
            key={index}
            className={`program-accent-fill w-2 rounded-full transition-opacity ${active ? 'animate-pulse opacity-90' : 'opacity-45'}`}
            style={{
              height: `${height}px`,
              animationDelay: `${index * 90}ms`,
              animationDuration: `${700 + index * 35}ms`,
            }}
          />
        ))}
      </div>
      <div className="flex items-center gap-2 text-sm font-semibold text-muted">
        <Volume2 className="h-4 w-4 text-program-accent" />
        {label}
      </div>
    </div>
  );
}
