import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { selectRestoredEnrollmentPrompt, type EnrollmentConversationTurn } from '../src/utils/enrollmentResumeSpeech';

const source = readFileSync(new URL('../src/components/Dashboard.tsx', import.meta.url), 'utf8');
const onlineHistory = source.slice(
  source.indexOf('const hydrateOnlineInterviewHistory ='),
  source.indexOf('const beginOnlineInterviewResponse ='),
);
const restore = source.slice(
  source.indexOf('const resumeOwnedOfflineActivity ='),
  source.indexOf('const companyTypes ='),
);
const playback = source.slice(
  source.indexOf('const speakRestoredEnrollmentPrompt ='),
  source.indexOf('const selectCachedOfflineInterviewEngine ='),
);
const repeat = source.slice(
  source.indexOf('const getCurrentRepeatQuestion ='),
  source.indexOf('const finishOnlineInterviewResponse ='),
);

const question = (text: string): EnrollmentConversationTurn => ({ sender: 'ai', text });
const answer = (text: string): EnrollmentConversationTurn => ({ sender: 'user', text });

test('only the current unanswered University question is selected by session and turn identity', () => {
  assert.equal(selectRestoredEnrollmentPrompt('server:42', [], 0), null);
  assert.deepEqual(selectRestoredEnrollmentPrompt('server:42', [question('First question')], 0), {
    identity: 'server:42:ai:0', text: 'First question',
  });
  assert.equal(selectRestoredEnrollmentPrompt('server:42', [question('First question'), answer('My answer')], 1), null);
  assert.deepEqual(selectRestoredEnrollmentPrompt('server:42', [question('First question'), answer('My answer'), question('Second question')], 1), {
    identity: 'server:42:ai:2', text: 'Second question',
  });
  assert.equal(selectRestoredEnrollmentPrompt('server:42', [question('First question')], 1), null);
  assert.equal(selectRestoredEnrollmentPrompt('', [question('First question')], 0), null);
});

test('completed and inconsistent offline checkpoints never replay a historical prompt', () => {
  const completed = [
    question('Q1'), answer('A1'), question('Q2'), answer('A2'), question('Q3'),
    answer('A3'), question('Q4'), answer('A4'), question('Q5'), answer('A5'), question('Closing'),
  ] satisfies EnrollmentConversationTurn[];
  assert.equal(selectRestoredEnrollmentPrompt('local:one', completed, 5, 'Closing'), null);
  assert.equal(selectRestoredEnrollmentPrompt('local:one', [question('Current')], 0, 'Different question'), null);
  assert.equal(selectRestoredEnrollmentPrompt('local:one', [question('  ')], 0), null);
  assert.notEqual(selectRestoredEnrollmentPrompt('local:two', [question('Current')], 0)?.identity,
    selectRestoredEnrollmentPrompt('local:one', [question('Current')], 0)?.identity);
});

test('online history restores the saved turn and session_ready speaks it without requesting AI', () => {
  assert.match(onlineHistory, /payload\.type === 'history'[\s\S]*?hydrateOnlineInterviewHistory\(mode, payload\.messages\)/);
  assert.match(onlineHistory, /pendingRestoredEnrollmentPromptRef\.current = sessionIdRef\.current[\s\S]*?selectRestoredEnrollmentPrompt\(`server:\$\{sessionIdRef\.current\}`, turns, userTurns\)/);
  assert.match(onlineHistory, /payload\.type === 'session_ready'[\s\S]*?mode === 'enrollment'\) void speakRestoredEnrollmentPrompt\(\)/);
  assert.match(playback, /await speakOnlineInterviewResponse\(pending\.text\)/);
  assert.doesNotMatch(playback, /connectOnlineInterview|sendOnlineInterviewResponse|generateOfflineProfessorTurn|setConversationLog|setChatMessages/);
  assert.match(source, /await speakOnlineInterviewResponse\(responseText\)/);
});

test('offline restore replays only the current saved AI question, without another generation', () => {
  assert.match(restore, /setAiResponseText\(resumable\.currentQuestion\)/);
  assert.match(restore, /if \(latest\?\.sender === 'user'\) \{\s*await generateOfflineProfessorTurn/);
  assert.match(restore, /else if \(type === 'upcoming'\)[\s\S]*?selectRestoredEnrollmentPrompt\([\s\S]*?current\.currentQuestion[\s\S]*?void speakRestoredEnrollmentPrompt\(\)/);
  assert.match(playback, /checkpoint\?\.type !== 'upcoming' \|\| checkpoint\.status !== 'in_progress'/);
});

test('playback is once per restore and cancellation does not poison a later re-entry', () => {
  assert.match(playback, /spokenRestoredEnrollmentPromptRef\.current === pending\.identity/);
  assert.match(playback, /pendingRestoredEnrollmentPromptRef\.current = null;\s*spokenRestoredEnrollmentPromptRef\.current = pending\.identity/);
  assert.match(playback, /playbackGeneration === restoredEnrollmentPlaybackGenerationRef\.current/);
  assert.match(source, /const startInterviewSession = async \(\) => \{[\s\S]*?resetRestoredEnrollmentPlayback\(\)/);
  assert.match(source, /const exitInterview = \(\) => \{[\s\S]*?resetRestoredEnrollmentPlayback\(\);\s*cancelBrowserSpeech\(\)/);
  assert.match(source, /if \(type === 'upcoming'\) \{\s*clearPendingEnrollmentAudio\(\);\s*resetRestoredEnrollmentPlayback\(\)/);
  assert.match(playback, /isListeningRef\.current \|\| isMicTransitioningRef\.current[\s\S]*?enrollmentAudioProcessingRef\.current/);
});

test('Repeat Question uses the current saved prompt while speech-only capture and mobile framing remain intact', () => {
  assert.match(repeat, /const turns = conversationLogRef\.current;\s*return selectRestoredEnrollmentPrompt\(/);
  assert.match(repeat, /const currentQuestion = getCurrentRepeatQuestion\(\);[\s\S]*?await speakOnlineInterviewResponse\(currentQuestion\)/);
  assert.doesNotMatch(repeat, /connectOnlineInterview|sendOnlineInterviewResponse|generateOfflineProfessorTurn/);
  assert.match(source, /transcribeCapture: capture => processEnrollmentAudio/);
  assert.match(source, /<EnrollmentMobileCameraFraming \/>/);
  assert.match(source, /\{isThesis && <form onSubmit=\{submitTypedInterviewAnswer\}/);
});
