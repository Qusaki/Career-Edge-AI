export const CLEAR_AI_SPEECH_RATE = 0.82;
export const CLEAR_AI_SPEECH_PITCH = 1;
export const CLEAR_AI_SPEECH_VOLUME = 1;

export const getClearSpeechTimeoutMs = (text: string) =>
  Math.max(8000, text.length * 180);

