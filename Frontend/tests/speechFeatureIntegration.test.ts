import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readSource = (relativePath: string) => readFileSync(new URL(`../src/${relativePath}`, import.meta.url), 'utf8');

const hookSource = readSource('hooks/useSpeechInput.ts');
const dashboardSource = readSource('components/Dashboard.tsx');
const preTestSource = readSource('components/PreTestPage.tsx');
const postTestSource = readSource('components/PostTestPage.tsx');
const drillsSource = readSource('components/DrillsPage.tsx');

test('the shared hook is the only active SpeechRecognition implementation', () => {
  assert.match(dashboardSource, /useSpeechInput\(\)/);
  assert.doesNotMatch(dashboardSource, /webkitSpeechRecognition|new SpeechRecognition|recognition\.onresult/);
  assert.match(hookSource, /window\.SpeechRecognition \?\? window\.webkitSpeechRecognition/);
  assert.match(hookSource, /recognition\.lang = 'en-US'/);
  assert.match(hookSource, /recognition\.maxAlternatives = 1/);
  assert.doesNotMatch(hookSource, /\bany\b|as any|@ts-ignore|@ts-expect-error/);
});

test('stop waits for onend and the timeout never promotes interim text', () => {
  const stopCall = hookSource.indexOf('recognition.stop()');
  const onEnd = hookSource.indexOf('recognition.onend =');
  const delivery = hookSource.indexOf('claimCanonicalTranscript()');
  assert.ok(stopCall >= 0);
  assert.ok(onEnd > stopCall);
  assert.ok(delivery >= 0);
  assert.match(hookSource, /setTimeout\([\s\S]*?recognition\.abort\(\)[\s\S]*?deliverTranscript\(\)/);
  assert.doesNotMatch(hookSource, /finalTranscript\s*\|\|\s*interimTranscript/);
});

test('offline audio persistence remains before canonical activity delivery', () => {
  const persistAudio = hookSource.indexOf('await session.offlineAudio.persistAudio');
  const deliverAnswer = hookSource.indexOf('session.onTranscript(canonicalTranscript)');
  assert.ok(persistAudio >= 0);
  assert.ok(deliverAnswer > persistAudio);
});

test('Enrollment renders shared live speech and retains stream-based waveform analysis', () => {
  assert.match(dashboardSource, /liveTranscript \|\| 'Start speaking when you are ready\.'/);
  assert.match(dashboardSource, /aria-live="polite"/);
  assert.match(dashboardSource, /onStreamReady: attachInterviewWaveform/);
  assert.match(dashboardSource, /context\.createMediaStreamSource\(stream\)\.connect\(userAnalyserRef\.current\)/);
  assert.doesNotMatch(dashboardSource, /finalizedTranscript\s*\|\|\s*interimTranscript/);
});

test('Who Am I and Active Listening show live speech separately from persisted state', () => {
  assert.ok((preTestSource.match(/aria-live="polite"/g) ?? []).length >= 2);
  assert.match(preTestSource, /introTranscript[\s\S]*?liveTranscript/);
  assert.match(preTestSource, /visibleActiveListeningMessages[\s\S]*?liveTranscript/);
  assert.match(preTestSource, /resetSpeechTranscript\(\)[\s\S]*?messagesRef\.current = nextMessages/);
});

test('Post-Test shows a current live answer without weakening the five-answer boundary', () => {
  assert.match(postTestSource, /liveTranscript \|\| <span className="text-muted">/);
  assert.match(postTestSource, /!answerBoundary\.canAcceptAnswer/);
  assert.match(postTestSource, /requireExactPostTestAnswerCount\(currentMessages\)/);
  assert.match(postTestSource, /resetSpeechTranscript\(\)[\s\S]*?messagesRef\.current = checkpointMessages/);
});

test('normal and negotiation Drills display live text without committing interim messages', () => {
  assert.ok((drillsSource.match(/aria-live="polite"/g) ?? []).length >= 2);
  assert.match(drillsSource, /spokenResponse[\s\S]*?liveTranscript/);
  assert.match(drillsSource, /negotiationMessages[\s\S]*?liveTranscript/);
  assert.doesNotMatch(hookSource, /onTranscript\(.*interimTranscript/);
});

test('TTS is pending before speak and every microphone handler rejects overlap', () => {
  for (const source of [preTestSource, postTestSource, drillsSource]) {
    const pendingState = source.indexOf('setIsVoiceSpeaking(true)');
    const speakCall = source.indexOf('window.speechSynthesis.speak(utterance)');
    assert.ok(pendingState >= 0 && speakCall > pendingState);
    assert.match(source, /speechSynthesis\?\.speaking \|\| window\.speechSynthesis\?\.pending/);
  }
  assert.match(drillsSource, /disabled=\{negotiationLoading \|\| negotiationGameOver \|\| isVoiceSpeaking \|\| isFinalizing\}/);
  assert.match(drillsSource, /disabled=\{isVoiceSpeaking \|\| isFinalizing \|\| drillTimer\?\.phase === 'expired'\}/);
  assert.match(dashboardSource, /isAiSpeakingRef\.current \|\| window\.speechSynthesis\?\.speaking \|\| window\.speechSynthesis\?\.pending/);
});

test('fatal recognition errors shut down online input while offline recording remains recoverable', () => {
  assert.match(hookSource, /session\.fatalError = true/);
  assert.match(hookSource, /if \(!session\.offlineAudio\)[\s\S]*?session\.cancelled = true[\s\S]*?releaseMicrophone\(\)/);
  assert.match(hookSource, /session\.offlineAudio && session\.fatalError && listeningRef\.current/);
});
