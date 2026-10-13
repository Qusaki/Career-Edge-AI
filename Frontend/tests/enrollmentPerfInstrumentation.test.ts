import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { EnrollmentPerfTrace } from '../src/utils/enrollmentPerf';

const dashboard = readFileSync(new URL('../src/components/Dashboard.tsx', import.meta.url), 'utf8');
const hook = readFileSync(new URL('../src/hooks/useSpeechInput.ts', import.meta.url), 'utf8');
const speech = readFileSync(new URL('../src/utils/browserSpeech.ts', import.meta.url), 'utf8');

test('timing output accepts only opaque ID, approved events, boolean fallback, and durations', () => {
  const lines: string[] = [];
  let now = 100;
  const trace = new EnrollmentPerfTrace(() => now, line => lines.push(line), 'abcdef123456');
  trace.mark('micStop');
  now = 125;
  trace.mark('canonicalTranscriptReady');
  trace.transcriptionUsed(false);
  trace.mark('student answer text' as 'micStop');
  assert.equal(trace.duration('micStop', 'canonicalTranscriptReady'), 25);
  assert.equal(trace.duration('micStop', 'ttsStart'), null);
  assert.equal(lines.length, 3);
  assert.match(lines.join('\n'), /transcriptionUsed=false/);
  assert.doesNotMatch(lines.join('\n'), /student answer text/);
  assert.throws(() => new EnrollmentPerfTrace(() => 0, () => undefined, 'user-123'));
});

test('browser-final path marks canonical transcript before separately timed recorder stop', () => {
  assert.match(hook, /if \(canonicalTranscript\) \{\s*session\.onTiming\?\.\('canonicalTranscriptReady'\);\s*session\.onTiming\?\.\('transcriptionUsed', false\)/);
  assert.match(hook, /session\.onTiming\?\.\('recorderStopStart'\);\s*const capture = await offlineRecorderRef\.current\?\.stopRecording\(\) \?\? null;\s*session\.onTiming\?\.\('recorderStopEnd'\)/);
  assert.match(hook, /sessionRef\.current\?\.onTiming\?\.\('micStop'\);[\s\S]*?recognition\.stop\(\)/);
  assert.match(dashboard, /current\.type === 'upcoming' && current\.mode === 'online' && enrollmentPerfEnabled\(\)/);
  assert.match(dashboard, /catch \{ \/\* Diagnostics must never prevent microphone capture\. \*\/ \}/);
});

test('fallback transcription and checkpoint are timed without moving either await', () => {
  assert.match(dashboard, /enrollmentPerf\?\.transcriptionUsed\(true\);\s*enrollmentPerf\?\.mark\('transcriptionStart'\);\s*try \{\s*const transcript = await transcribeAnswer/);
  assert.match(dashboard, /finally \{\s*enrollmentPerf\?\.mark\('transcriptionEnd'\)/);
  assert.match(dashboard, /enrollmentPerf\?\.mark\('checkpointStart'\);\s*const saved = await updateActivityCheckpoint\(/);
  assert.match(dashboard, /enrollmentPerf\?\.mark\('checkpointEnd'\);\s*if \(!saved\)/);
  assert.match(dashboard, /if \(!text \|\| offlineAnswerSubmissionRef\.current\)/);
  assert.match(dashboard, /sendOnlineInterviewResponse\(mode, text, isFinal\)/);
});

test('one canonical send and first chunk precede turn completion and actual TTS onstart', () => {
  const lines: string[] = [];
  const trace = new EnrollmentPerfTrace(() => 1, line => lines.push(line), 'abcdef123456');
  trace.markOnce('frontendFirstChunk');
  trace.markOnce('frontendFirstChunk');
  trace.markOnce('ttsStart');
  trace.markOnce('ttsStart');
  assert.equal(lines.filter(line => line.includes('frontendFirstChunk')).length, 1);
  assert.equal(lines.filter(line => line.includes('ttsStart')).length, 1);
  const submission = dashboard.slice(dashboard.indexOf('const submitInterviewAnswer ='), dashboard.indexOf('const submitTypedInterviewAnswer ='));
  assert.equal((submission.match(/sendOnlineInterviewResponse\(mode, text, isFinal\)/g) ?? []).length, 1);
  assert.match(dashboard, /enrollmentPerf\?\.mark\('websocketSendStart'\);\s*socket\.send\(JSON\.stringify/);
  assert.match(dashboard, /enrollmentPerf\?\.mark\('websocketSend'\)/);
  assert.match(dashboard, /enrollmentPerfRef\.current\?\.markOnce\('frontendFirstChunk'\)/);
  assert.match(dashboard, /enrollmentPerfRef\.current\?\.mark\('turnCompleteReceived'\)/);
  assert.match(dashboard, /enrollmentPerf\?\.mark\('ttsRequested'\);\s*await speakOnlineInterviewResponse\(responseText, enrollmentPerf/);
  assert.match(dashboard, /enrollmentPerf\.markOnce\('ttsStart'\)/);
  assert.match(speech, /utterance\.onstart = \(\) => \{[\s\S]*?options\.onStart\?\.\(\)/);
});
