export interface EyeContactSummary {
  score: number | null;
  samples: number;
}

type EyeContactWindow = {
  hits: number;
  samples: number;
};

const toWindow = (summary: EyeContactSummary | null): EyeContactWindow => {
  if (!summary || !Number.isFinite(summary.samples) || summary.samples <= 0) {
    return { hits: 0, samples: 0 };
  }
  const samples = Math.max(0, Math.round(summary.samples));
  const numericScore = typeof summary.score === 'number' && Number.isFinite(summary.score)
    ? summary.score
    : 0;
  const boundedScore = Math.min(100, Math.max(0, numericScore));
  const hits = Math.min(samples, Math.max(0, Math.round((boundedScore / 100) * samples)));
  return { hits, samples };
};

export const combineEyeContactSummaries = (
  restoredBaseline: EyeContactSummary | null,
  currentLiveWindow: EyeContactSummary,
): EyeContactSummary => {
  const baseline = toWindow(restoredBaseline);
  const liveWindow = toWindow(currentLiveWindow);
  const samples = baseline.samples + liveWindow.samples;
  if (samples === 0) return { score: null, samples: 0 };
  const hits = baseline.hits + liveWindow.hits;
  return {
    score: Math.round((hits / samples) * 100),
    samples,
  };
};
