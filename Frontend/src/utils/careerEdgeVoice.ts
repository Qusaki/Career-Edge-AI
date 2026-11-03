export const CAREER_EDGE_SPEECH_RATE = 0.95;
export const CAREER_EDGE_SPEECH_PITCH = 1.02;
export const CAREER_EDGE_SPEECH_VOLUME = 1;
export const CAREER_EDGE_SPEECH_LANGUAGE = 'en-US';

const isLocalEnglishVoice = (voice: SpeechSynthesisVoice): boolean =>
  voice.localService === true && /^en(?:-|$)/i.test(voice.lang);

const voiceRank = (voice: SpeechSynthesisVoice): number => {
  if (/\b(natural|enhanced|premium)\b/i.test(voice.name)) return 0;
  if (/\b(microsoft|google|apple|samantha|ava|alex|siri)\b/i.test(voice.name)) return 1;
  return /^en-US$/i.test(voice.lang) ? 2 : 3;
};

export const selectCareerEdgeVoice = (voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined =>
  voices.filter(isLocalEnglishVoice).sort((left, right) =>
    voiceRank(left) - voiceRank(right)
    || Number(!/^en-US$/i.test(left.lang)) - Number(!/^en-US$/i.test(right.lang))
    || left.name.localeCompare(right.name)
    || left.voiceURI.localeCompare(right.voiceURI)
  )[0];
