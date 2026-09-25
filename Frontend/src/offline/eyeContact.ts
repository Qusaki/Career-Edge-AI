export interface EyeContactSummary {
  score: number | null;
  samples: number;
}

export const shouldCheckpointEyeContact = (currentSamples: number, lastSavedSamples: number) =>
  Number.isSafeInteger(currentSamples) && currentSamples > 0
  && currentSamples - lastSavedSamples >= 8;

type EyeContactWindow = {
  hits: number;
  samples: number;
};

const toWindow = (summary: EyeContactSummary | null): EyeContactWindow => {
  if (!summary || !Number.isFinite(summary.samples) || summary.samples <= 0
    || typeof summary.score !== 'number' || !Number.isFinite(summary.score)) {
    return { hits: 0, samples: 0 };
  }
  const samples = Math.max(0, Math.round(summary.samples));
  const boundedScore = Math.min(100, Math.max(0, summary.score));
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
