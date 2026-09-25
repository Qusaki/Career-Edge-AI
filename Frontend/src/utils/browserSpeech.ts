type SpeechOutcome = 'ended' | 'error' | 'start-timeout' | 'duration-timeout' | 'cancelled';
export type SpeechPlaybackResult = SpeechOutcome | 'unavailable';

export interface BrowserSpeechOptions {
  onPending?: () => void;
  onStart?: () => void;
  onFinish?: () => void;
  selectVoice?: (voices: SpeechSynthesisVoice[], language: string) => SpeechSynthesisVoice | undefined;
  language?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
  voiceWaitMs?: number;
  startTimeoutMs?: number;
  maxDurationMs?: number;
  synthesis?: SpeechSynthesis;
  createUtterance?: (text: string) => SpeechSynthesisUtterance;
}

let generation = 0;
let cancelActiveAttempt: (() => void) | null = null;
let finishActiveState: (() => void) | null = null;

export const cancelBrowserSpeech = (synthesis = window.speechSynthesis) => {
  generation += 1;
  finishActiveState?.();
  finishActiveState = null;
  cancelActiveAttempt?.();
  cancelActiveAttempt = null;
  synthesis?.cancel();
};

const waitForVoices = (synthesis: SpeechSynthesis, waitMs: number): Promise<SpeechSynthesisVoice[]> => {
  const available = synthesis.getVoices();
  if (available.length > 0 || waitMs <= 0) return Promise.resolve(available);
  return new Promise(resolve => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      synthesis.removeEventListener('voiceschanged', finish);
      resolve(synthesis.getVoices());
    };
    synthesis.addEventListener('voiceschanged', finish);
    const timer = setTimeout(finish, waitMs);
    if (synthesis.getVoices().length > 0) finish();
  });
};

export async function speakBrowserText(text: string, options: BrowserSpeechOptions = {}): Promise<SpeechPlaybackResult> {
  const synthesis = options.synthesis ?? (typeof window !== 'undefined' ? window.speechSynthesis : undefined);
  const createUtterance = options.createUtterance ?? ((value: string) => new SpeechSynthesisUtterance(value));
  if (!synthesis || !text.trim()) return 'unavailable';

  cancelBrowserSpeech(synthesis);
  const currentGeneration = generation;
  options.onPending?.();
  finishActiveState = options.onFinish ?? null;
  const resumeWhenVisible = () => {
    if (currentGeneration === generation && document.visibilityState === 'visible') synthesis.resume();
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', resumeWhenVisible);
  let result: SpeechPlaybackResult = 'unavailable';
  try {
    const voices = await waitForVoices(synthesis, options.voiceWaitMs ?? 350);
    if (currentGeneration !== generation) return 'cancelled';
    const language = options.language ?? 'en-US';
    for (let attempt = 0; attempt < 2 && currentGeneration === generation; attempt += 1) {
      const utterance = createUtterance(text);
      utterance.lang = language;
      utterance.rate = options.rate ?? 1;
      utterance.pitch = options.pitch ?? 1;
      utterance.volume = options.volume ?? 1;
      const preferredVoice = options.selectVoice?.(voices, language);
      if (preferredVoice) utterance.voice = preferredVoice;

      const outcome = await new Promise<SpeechOutcome>(resolve => {
        let settled = false;
        let started = false;
        const settle = (result: SpeechOutcome) => {
          if (settled) return;
          settled = true;
          clearTimeout(startTimer);
          clearTimeout(durationTimer);
          if (cancelActiveAttempt === cancelAttempt) cancelActiveAttempt = null;
          resolve(result);
        };
        const cancelAttempt = () => settle('cancelled');
        cancelActiveAttempt = cancelAttempt;
        utterance.onstart = () => {
          if (currentGeneration !== generation || settled) return;
          started = true;
          clearTimeout(startTimer);
          options.onStart?.();
        };
        utterance.onend = () => settle('ended');
        utterance.onerror = () => settle('error');
        const startTimer = setTimeout(() => {
          if (!started) {
            settle('start-timeout');
            synthesis.cancel();
          }
        }, options.startTimeoutMs ?? 2500);
        const durationTimer = setTimeout(() => {
          settle('duration-timeout');
          synthesis.cancel();
        }, options.maxDurationMs ?? Math.min(120000, Math.max(10000, text.length * 90)));
        try {
          synthesis.resume();
          synthesis.speak(utterance);
        } catch {
          settle('error');
        }
      });
      result = outcome;
      if (outcome !== 'start-timeout') break;
    }
  } catch {
    if (currentGeneration === generation) synthesis.cancel();
    result = 'error';
  } finally {
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', resumeWhenVisible);
    if (currentGeneration === generation) {
      finishActiveState = null;
      options.onFinish?.();
    }
  }
  return result;
}
