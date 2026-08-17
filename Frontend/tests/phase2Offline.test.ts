import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { appendOfflinePostTestAnswer } from '../src/offline/activityRuntime';
import { evaluateActiveListening, evaluateDrill, evaluatePostTest, evaluateWhoAmI, getOfflineNegotiationTurn } from '../src/offline/localEvaluation';
import {
  ACTIVE_LISTENING_PROMPTS,
  DRILLS_VERSION,
  getOfflineActiveListeningPrompt,
  getOfflineDrillPrompt,
  getPostTestQuestions,
  hasCurrentQuestionPack,
  POST_TEST_VERSION,
  PRETEST_ACTIVE_LISTENING_VERSION,
  PRETEST_WHO_AM_I_VERSION,
} from '../src/offline/questionPacks';
import { selectOwnedResumableSessions, selectOwnedSyncQueue } from '../src/offline/selectors';
import {
  createActivityCheckpoint,
  createCompletedLocalCheckpoint,
  createPendingSyncCheckpoint,
  mergeActivityCheckpoint,
} from '../src/offline/sessionFoundation';
import { isCompletedActivity } from '../src/utils/analytics';

test('Pre-Test, Post-Test, and Drill sessions can start directly in offline mode', () => {
  const starts = [
    createActivityCheckpoint(1, { type: 'pre_test_intro', mode: 'offline', questionPackVersion: PRETEST_WHO_AM_I_VERSION }),
    createActivityCheckpoint(1, { type: 'pre_test_active_listening', mode: 'offline', questionPackVersion: PRETEST_ACTIVE_LISTENING_VERSION }),
    createActivityCheckpoint(1, { type: 'post_test', mode: 'offline', questionPackVersion: POST_TEST_VERSION }),
    createActivityCheckpoint(1, { type: 'drill', mode: 'offline', questionPackVersion: DRILLS_VERSION }),
  ];
  assert.ok(starts.every(session => session.mode === 'offline' && session.status === 'in_progress'));
  assert.ok(starts.every(session => session.serverSessionId === null));
});

test('offline packs preserve canonical question order and deterministic selection', () => {
  assert.equal(ACTIVE_LISTENING_PROMPTS.length, 3);
  assert.match(ACTIVE_LISTENING_PROMPTS[0], /one hundred twenty incoming students/);
  assert.match(ACTIVE_LISTENING_PROMPTS[2], /seventy-two arrived/);
  assert.equal(getOfflineActiveListeningPrompt('stable-id'), getOfflineActiveListeningPrompt('stable-id'));

  const ccit = getPostTestQuestions('CCIT');
  const cte = getPostTestQuestions('CTE');
  const cbapa = getPostTestQuestions('CBAPA');
  assert.equal(ccit.length, 5);
  assert.equal(ccit[0], cte[0]);
  assert.match(ccit[1], /technical idea/);
  assert.match(cte[1], /difficult lesson/);
  assert.match(cbapa[1], /business, financial, or policy/);
  assert.equal(ccit[4], 'What communication skill do you still want to improve, and what specific actions will you take to improve it?');

  assert.deepEqual(getOfflineDrillPrompt('crisis', 'stable-drill'), getOfflineDrillPrompt('crisis', 'stable-drill'));
});

test('offline Post-Test advances from saved progress without restarting or duplicating questions', () => {
  const questions = getPostTestQuestions('CCIT');
  const existing = [
    { sender: 'ai' as const, text: questions[0] },
    { sender: 'user' as const, text: 'Answer one' },
    { sender: 'ai' as const, text: questions[1] },
  ];
  const next = appendOfflinePostTestAnswer(existing, 'Answer two', questions);
  assert.equal(next.answerCount, 2);
  assert.equal(next.nextQuestion, questions[2]);
  assert.equal(next.conversationLog.filter(turn => turn.text === questions[0]).length, 1);
  assert.equal(next.conversationLog.at(-1)?.text, questions[2]);
});

test('provisional local evaluators reproduce existing deterministic rules', () => {
  const intro = evaluateWhoAmI('one two three four five six seven eight nine ten');
  assert.equal(intro.localScore, 9);

  const listening = evaluateActiveListening([{ sender: 'user', text: Array(40).fill('word').join(' ') }]);
  assert.equal(listening.localScore, 16);

  const post = evaluatePostTest(Array.from({ length: 5 }, (_, index) => ({ sender: 'user' as const, text: `answer ${index}` })));
  assert.equal(post.localScore, 20);

  const drill = evaluateDrill('fast_word', { spokenResponse: 'one two three four five six seven eight', negotiationMessages: [] });
  assert.equal(drill.localScore, 76.67);
  assert.equal(drill.evaluation.scoring.rubric_version, 'drill-communication-v1');
});

test('offline Active Listening stores raw response while AI feedback remains pending', () => {
  const session = createActivityCheckpoint(7, {
    type: 'pre_test_active_listening',
    mode: 'offline',
    questionPackVersion: PRETEST_ACTIVE_LISTENING_VERSION,
  }, 'offline', 'listening-session');
  const saved = mergeActivityCheckpoint(session, {
    conversationLog: [{ sender: 'user', text: 'My summary' }],
    answers: [{ step: 1, text: 'My summary', createdAt: 1 }],
    pendingEvaluation: { aiFeedback: true },
  });
  assert.deepEqual(saved.answers.map(answer => answer.text), ['My summary']);
  assert.equal(saved.pendingEvaluation?.aiFeedback, true);
  assert.equal(saved.localScore, null);
});

test('local completion is persisted conceptually before it can enter pending sync', () => {
  const active = createActivityCheckpoint(4, { type: 'post_test', mode: 'offline', questionPackVersion: POST_TEST_VERSION }, 'offline', 'post-session');
  assert.throws(() => createPendingSyncCheckpoint(active), /safely persisted local completion/);
  const completed = createCompletedLocalCheckpoint(active);
  const queued = createPendingSyncCheckpoint(completed);
  assert.equal(completed.status, 'completed_local');
  assert.equal(queued.status, 'pending_sync');
  assert.equal(queued.syncState, 'queued');
  assert.equal(isCompletedActivity({ status: queued.status, total_score: 20 }), false);
});

test('resume and sync selection remain isolated between two backend user IDs', () => {
  const records = [
    { userId: 11, status: 'in_progress', mode: 'offline', updatedAt: 3, id: 'a-resume' },
    { userId: 12, status: 'in_progress', mode: 'offline', updatedAt: 4, id: 'b-resume' },
    { userId: 11, status: 'pending_sync', mode: 'offline', updatedAt: 5, id: 'a-sync' },
    { userId: 12, status: 'pending_sync', mode: 'offline', updatedAt: 6, id: 'b-sync' },
  ];
  assert.deepEqual(selectOwnedResumableSessions(records, 11).map(item => item.id), ['a-resume']);
  assert.deepEqual(selectOwnedResumableSessions(records, 12).map(item => item.id), ['b-resume']);
  assert.deepEqual(selectOwnedSyncQueue(records, 11).map(item => item.id), ['a-sync']);
  assert.deepEqual(selectOwnedSyncQueue(records, 12).map(item => item.id), ['b-sync']);
});

test('stable client ID and offline lock survive refresh-style checkpoint restoration', () => {
  const original = createActivityCheckpoint(9, {
    type: 'drill', mode: 'offline', questionPackVersion: DRILLS_VERSION,
    activityState: { drillType: 'jam' },
  }, 'offline', 'stable-client-id');
  const restored = mergeActivityCheckpoint(original, { currentStep: 1, mode: 'online' });
  assert.equal(restored.clientSessionId, 'stable-client-id');
  assert.equal(restored.mode, 'offline');
  assert.deepEqual(restored.activityState, { drillType: 'jam' });
});

test('question-pack mismatches are rejected without changing the saved record', () => {
  assert.equal(hasCurrentQuestionPack('post_test', POST_TEST_VERSION), true);
  assert.equal(hasCurrentQuestionPack('post_test', 'posttest-v0'), false);
  assert.equal(hasCurrentQuestionPack('drill', null), false);
});

test('offline negotiation mirrors the canonical deterministic backend decisions', () => {
  assert.equal(getOfflineNegotiationTurn('I accept the offer', 0, 35000).isGameOver, true);
  assert.equal(getOfflineNegotiationTurn('Can we discuss benefits?', 0, 35000).newOffer, 35000);
  assert.equal(getOfflineNegotiationTurn('I need a higher salary', 0, 35000).newOffer, 37000);
  assert.match(getOfflineNegotiationTurn('Still higher', 5, 40000).response, /final offer/);
});

test('Phase 2 offline pages do not import WebLLM or Gemini and contain direct local starts', () => {
  for (const file of ['PreTestPage.tsx', 'PostTestPage.tsx', 'DrillsPage.tsx']) {
    const source = readFileSync(new URL(`../src/components/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /ensureOfflineAIReady|useWebLLM|Gemini|@mlc-ai/);
    assert.match(source, /mode:\s*'offline'/);
    assert.match(source, /if \(!effectiveOnline\)/);
  }
  const listeningSource = readFileSync(new URL('../src/components/PreTestPage.tsx', import.meta.url), 'utf8');
  assert.match(listeningSource, /aiFeedback:\s*true/);
});
