import { selectCareerEdgeVoice } from './careerEdgeVoice';

/** Active Listening alone also recognizes locally installed "neural" voices. */
export const selectActiveListeningVoice = (
  voices: SpeechSynthesisVoice[],
): SpeechSynthesisVoice | undefined => {
  const naturalLocalEnglish = voices.filter(voice =>
    voice.localService === true
    && /^en(?:-|$)/i.test(voice.lang)
    && /\b(natural|enhanced|premium|neural)\b/i.test(voice.name)
  );
  return selectCareerEdgeVoice(naturalLocalEnglish) ?? selectCareerEdgeVoice(voices);
};
