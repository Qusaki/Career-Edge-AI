import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SpeechFocusOverlay } from '../src/components/SpeechFocusOverlay';

const readSource = (relativePath: string) => readFileSync(new URL(`../src/${relativePath}`, import.meta.url), 'utf8');

const overlaySource = readSource('components/SpeechFocusOverlay.tsx');
const dashboardSource = readSource('components/Dashboard.tsx');
const preTestSource = readSource('components/PreTestPage.tsx');
const postTestSource = readSource('components/PostTestPage.tsx');
const drillsSource = readSource('components/DrillsPage.tsx');
const speechInputSource = readSource('hooks/useSpeechInput.ts');

const renderOverlay = (isOpen: boolean, liveTranscript = '') => renderToStaticMarkup(
  <SpeechFocusOverlay isOpen={isOpen} liveTranscript={liveTranscript} onStop={() => {}} />,
);

const findButton = (node: ReactNode): ReactElement<{ onClick?: () => void }> | null => {
  if (!isValidElement(node)) return null;
  if (node.type === 'button') return node as ReactElement<{ onClick?: () => void }>;
  const children = (node.props as { children?: ReactNode }).children;
  for (const child of Children.toArray(children)) {
    const button = findButton(child);
    if (button) return button;
  }
  return null;
};

test('the speech focus overlay is absent while the microphone is not listening', () => {
  assert.equal(renderOverlay(false), '');
});

test('the listening surface uses lightweight group semantics and a normal microphone icon', () => {
  const markup = renderOverlay(true);
  assert.match(markup, /role="group"/);
  assert.match(markup, /aria-label="Active microphone"/);
  assert.doesNotMatch(markup, /role="dialog"|aria-modal="true"/);
  assert.match(markup, /Listening\.\.\./);
  assert.match(markup, /You can speak now/);
  assert.match(markup, /lucide-mic/);
  assert.doesNotMatch(markup, /lucide-mic-off/);
  assert.match(markup, /aria-label="Stop microphone"/);
});

test('the overlay does not duplicate the live transcript from the underlying page', () => {
  const markup = renderOverlay(true, 'My name is John and I am studying');
  assert.doesNotMatch(markup, /My name is John and I am studying/);
  assert.doesNotMatch(markup, /Live speech transcript|Your words will appear here/);
});

test('the prominent microphone delegates directly to the existing speech stop callback', () => {
  let stopCalls = 0;
  const overlay = SpeechFocusOverlay({ isOpen: true, liveTranscript: '', onStop: () => { stopCalls += 1; } });
  const button = findButton(overlay);
  assert.ok(button);
  button.props.onClick?.();
  assert.equal(stopCalls, 1);
  assert.match(overlaySource, /onClick=\{onStop\}/);
  assert.match(overlaySource, /aria-label="Stop microphone"/);
  assert.doesNotMatch(overlaySource, /startListening|SpeechRecognition|fetch\(|axios|onTranscript/);
});

test('the overlay is a responsive mic-only treatment with a light blur and no card shell', () => {
  assert.match(overlaySource, /fixed inset-0/);
  assert.match(overlaySource, /backdrop-blur-sm/);
  assert.match(overlaySource, /bg-slate-950\/30/);
  assert.match(overlaySource, /h-20 w-20[\s\S]*?rounded-full bg-emerald-500/);
  assert.doesNotMatch(overlaySource, /<section|bg-slate-900\/95|max-w-lg|min-h-28|rounded-3xl/);
  assert.doesNotMatch(overlaySource, /Stop listening|bg-rose-600/);
});

test('Enrollment opens the overlay only in its interview session while listening', () => {
  assert.match(dashboardSource, /isOpen=\{activeTab === 'interview-session' && isListening\}/);
  assert.match(dashboardSource, /liveTranscript=\{liveTranscript\}/);
  assert.match(dashboardSource, /onStop=\{\(\) => void toggleListening\(\)\}/);
  assert.match(dashboardSource, /aria-pressed=\{isListening\}/);
  assert.doesNotMatch(dashboardSource, /isRecognitionReady/);
});

test('Who Am I and Active Listening share the listening-only overlay', () => {
  assert.match(preTestSource, /<SpeechFocusOverlay isOpen=\{isListening\} liveTranscript=\{liveTranscript\} onStop=\{stopListening\} \/>/);
  assert.match(preTestSource, /disabled=\{isPersistingIntro \|\| isFinalizing \|\| isVoiceSpeaking\}/);
  assert.match(preTestSource, /connectionState !== 'ready' \|\| isAiResponding \|\| isVoiceSpeaking/);
});

test('Post-Test keeps the five-answer boundary and TTS guard around overlay entry', () => {
  assert.match(postTestSource, /<SpeechFocusOverlay isOpen=\{isListening\} liveTranscript=\{liveTranscript\} onStop=\{stopListening\} \/>/);
  assert.match(postTestSource, /!answerBoundary\.canAcceptAnswer/);
  assert.match(postTestSource, /isAiResponding \|\| isVoiceSpeaking/);
});

test('normal and negotiation Drills share the overlay and retain their TTS guards', () => {
  assert.match(drillsSource, /<SpeechFocusOverlay isOpen=\{isListening\} liveTranscript=\{liveTranscript\} onStop=\{stopListening\} \/>/);
  assert.match(drillsSource, /disabled=\{negotiationLoading \|\| negotiationGameOver \|\| isVoiceSpeaking \|\| isFinalizing\}/);
  assert.match(drillsSource, /disabled=\{isVoiceSpeaking \|\| isFinalizing\}/);
});

test('active controls use Mic and inactive controls use MicOff on each active exercise surface', () => {
  for (const source of [preTestSource, postTestSource, drillsSource]) {
    assert.match(source, /isListening \? <Mic className="h-5 w-5" \/> : <MicOff className="h-5 w-5" \/>/);
    assert.doesNotMatch(source, /isListening \? <MicOff className="h-5 w-5" \/> : <Mic className="h-5 w-5" \/>/);
  }
  assert.match(dashboardSource, /\{isListening \? \([\s\S]*?<Mic className="h-\[18px\] w-\[18px\] shrink-0"[\s\S]*?\) : \([\s\S]*?<MicOff className="relative z-10 h-\[22px\] w-\[22px\]"/);
});

test('stopping listening closes the overlay before finalization and canonical delivery', () => {
  assert.match(speechInputSource, /const stopListening = useCallback\(\(\) => \{[\s\S]*?setIsListening\(false\);[\s\S]*?setIsFinalizing\(true\)/);
  assert.match(speechInputSource, /claimCanonicalTranscript\(\)[\s\S]*?if \(canonicalTranscript\) session\.onTranscript\(canonicalTranscript\)/);
  assert.doesNotMatch(speechInputSource, /session\.onTranscript\([^\n]*interimTranscript/);
});
