import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const readSource = (relativePath: string) => readFileSync(new URL(`../src/${relativePath}`, import.meta.url), 'utf8');

const dashboardSource = readSource('components/Dashboard.tsx');
const preTestSource = readSource('components/PreTestPage.tsx');
const postTestSource = readSource('components/PostTestPage.tsx');
const drillsSource = readSource('components/DrillsPage.tsx');
const speechInputSource = readSource('hooks/useSpeechInput.ts');
const activitySources = [dashboardSource, preTestSource, postTestSource, drillsSource];

const enrollmentControlsStart = dashboardSource.indexOf('Integrated meeting controls');
const enrollmentControlsEnd = dashboardSource.indexOf('Leave interview without validating', enrollmentControlsStart);
const enrollmentControls = dashboardSource.slice(enrollmentControlsStart, enrollmentControlsEnd);

test('the dedicated speech focus overlay and its active feature usage are removed', () => {
  assert.equal(existsSync(new URL('../src/components/SpeechFocusOverlay.tsx', import.meta.url)), false);
  for (const source of activitySources) assert.doesNotMatch(source, /SpeechFocusOverlay/);
});

test('listening no longer renders a blur, dimming backdrop, or floating microphone surface', () => {
  assert.ok(enrollmentControlsStart >= 0 && enrollmentControlsEnd > enrollmentControlsStart);
  for (const source of [preTestSource, postTestSource, drillsSource]) {
    assert.doesNotMatch(source, /isListening[\s\S]{0,160}fixed inset-0|isListening[\s\S]{0,160}backdrop-blur/);
  }
  assert.doesNotMatch(enrollmentControls, /fixed inset-0|backdrop-blur|bg-slate-950\/30/);
});

test('Pre-Test, Post-Test, and Drills consistently render Mic only while listening', () => {
  for (const source of [preTestSource, postTestSource, drillsSource]) {
    assert.match(source, /isListening \? <Mic className="h-5 w-5" \/> : <MicOff className="h-5 w-5" \/>/);
    assert.doesNotMatch(source, /isListening \? <MicOff className="h-5 w-5" \/> : <Mic className="h-5 w-5" \/>/);
  }
});

test('Enrollment uses its existing Mic while listening and MicOff otherwise', () => {
  assert.match(enrollmentControls, /\{isListening \? \([\s\S]*?<Mic className="h-\[18px\] w-\[18px\] shrink-0"/);
  assert.match(enrollmentControls, /\) : \(\s*<MicOff className="relative z-10 h-\[22px\] w-\[22px\]"/);
  assert.match(enrollmentControls, /aria-pressed=\{isListening\}/);
});

test('finalizing renders the inactive icon and prevents a new microphone start', () => {
  assert.match(preTestSource, /disabled=\{isPersistingIntro \|\| isFinalizing \|\| isVoiceSpeaking\}/);
  assert.match(postTestSource, /isSubmittingAnswer \|\| isFinalizing \|\| !answerBoundary\.canAcceptAnswer/);
  assert.match(drillsSource, /disabled=\{isVoiceSpeaking \|\| isFinalizing\}/);
  assert.match(enrollmentControls, /disabled=\{isMicTransitioning \|\| isAiSpeaking \|\| isSubmittingOfflineAnswer/);
});

test('permission loading remains visually inactive until the shared listening state begins', () => {
  const permissionRequest = speechInputSource.indexOf('await navigator.mediaDevices.getUserMedia');
  const listeningState = speechInputSource.indexOf('setIsListening(true)', permissionRequest);
  assert.ok(permissionRequest >= 0 && listeningState > permissionRequest);
});

test('TTS overlap guards remain in every microphone entry path', () => {
  assert.match(dashboardSource, /isAiSpeakingRef\.current \|\| window\.speechSynthesis\?\.speaking \|\| window\.speechSynthesis\?\.pending/);
  for (const source of [preTestSource, postTestSource, drillsSource]) {
    assert.match(source, /speechSynthesis\?\.speaking \|\| window\.speechSynthesis\?\.pending/);
  }
});

test('live transcripts remain visible in each original activity UI', () => {
  assert.match(dashboardSource, /liveTranscript \|\| 'Start speaking when you are ready\.'/);
  assert.ok((preTestSource.match(/liveTranscript \|\| <span className="text-muted">/g) ?? []).length >= 2);
  assert.match(postTestSource, /liveTranscript \|\| <span className="text-muted">/);
  assert.ok((drillsSource.match(/liveTranscript \|\| <span className="text-muted">/g) ?? []).length >= 2);
});

test('stop still exits listening before canonical final-only delivery', () => {
  assert.match(speechInputSource, /const stopListening = useCallback\(\(\) => \{[\s\S]*?setIsListening\(false\);[\s\S]*?setIsFinalizing\(true\)/);
  assert.match(speechInputSource, /claimCanonicalTranscript\(\)[\s\S]*?if \(canonicalTranscript\) session\.onTranscript\(canonicalTranscript\)/);
  assert.doesNotMatch(speechInputSource, /session\.onTranscript\([^\n]*interimTranscript/);
});

test('Post-Test completion still prevents a sixth microphone answer', () => {
  assert.match(postTestSource, /!answerBoundary\.canAcceptAnswer/);
  assert.match(postTestSource, /requireExactPostTestAnswerCount\(currentMessages\)/);
});

test('offline audio and canonical Drill prompt protections remain intact', () => {
  for (const source of [preTestSource, postTestSource, drillsSource]) {
    assert.match(source, /persistAudio: onOfflineAudioCaptured/);
  }
  assert.match(dashboardSource, /persistAudio: persistOfflineAudioCapture/);
  assert.match(drillsSource, /canonical_prompt/);
});
