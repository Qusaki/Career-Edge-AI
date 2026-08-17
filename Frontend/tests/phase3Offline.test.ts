import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { ConversationTurn } from '../src/db';
import {
  appendOfflineInterviewAnswer,
  createOfflineInterviewActivityState,
  evaluateOfflineInterview,
  getFallbackProfessorTurn,
  MAX_THESIS_ABSTRACT_CONTEXT_LENGTH,
  OFFLINE_INTERVIEW_RESPONSE_LIMIT,
  readOfflineInterviewActivityState,
  transitionOfflineInterviewToFallback,
} from '../src/offline/interviewRuntime';
import {
  ENROLLMENT_INTERVIEW_VERSION,
  getEnrollmentInterviewQuestions,
  getThesisInterviewQuestions,
  hasCurrentQuestionPack,
  THESIS_INTERVIEW_VERSION,
} from '../src/offline/questionPacks';
import { selectOwnedResumableSessions, selectOwnedSyncQueue } from '../src/offline/selectors';
import {
  createActivityCheckpoint,
  createCompletedLocalCheckpoint,
  createPendingSyncCheckpoint,
  mergeActivityCheckpoint,
} from '../src/offline/sessionFoundation';
import { isCompletedActivity } from '../src/utils/analytics';

const completeFallbackInterview = (type: 'upcoming' | 'thesis', department: string) => {
  let conversation: ConversationTurn[] = [
    { sender: 'ai', text: getFallbackProfessorTurn(type, department, 0) },
  ];
  for (let index = 0; index < OFFLINE_INTERVIEW_RESPONSE_LIMIT; index += 1) {
    const turn = appendOfflineInterviewAnswer(conversation, `Answer ${index + 1}`);
    conversation = [
      ...turn.conversationLog,
      { sender: 'ai', text: getFallbackProfessorTurn(type, department, turn.responseCount) },
    ];
  }
  return conversation;
};

test('Enrollment and Thesis can start offline without a server session', () => {
  const enrollment = createActivityCheckpoint(1, {
    type: 'upcoming', mode: 'offline', questionPackVersion: ENROLLMENT_INTERVIEW_VERSION,
  }, 'offline', 'offline-enrollment');
  const thesis = createActivityCheckpoint(1, {
    type: 'thesis', mode: 'offline', questionPackVersion: THESIS_INTERVIEW_VERSION,
  }, 'offline', 'offline-thesis');
  assert.equal(enrollment.serverSessionId, null);
  assert.equal(thesis.serverSessionId, null);
  assert.equal(enrollment.mode, 'offline');
  assert.equal(thesis.mode, 'offline');
});

test('versioned fallback packs preserve five department-aligned questions', () => {
  for (const department of ['CCIT', 'CTE', 'CBAPA']) {
    const enrollment = getEnrollmentInterviewQuestions(department);
    const thesis = getThesisInterviewQuestions(department);
    assert.equal(enrollment.length, 5);
    assert.equal(thesis.length, 5);
    assert.equal(new Set(enrollment.map(question => question.id)).size, 5);
    assert.equal(new Set(thesis.map(question => question.id)).size, 5);
  }
  assert.match(getEnrollmentInterviewQuestions('CTE')[1].text, /subject area/i);
  assert.match(getEnrollmentInterviewQuestions('CBAPA')[4].text, /unethical/i);
  assert.match(getThesisInterviewQuestions('CCIT')[2].text, /validation/i);
  assert.match(getThesisInterviewQuestions('CTE')[3].text, /DepEd/i);
});

test('fallback Enrollment and Thesis complete exactly five responses', () => {
  for (const type of ['upcoming', 'thesis'] as const) {
    const conversation = completeFallbackInterview(type, 'CCIT');
    assert.equal(conversation.filter(turn => turn.sender === 'user').length, 5);
    assert.equal(conversation.filter(turn => turn.sender === 'ai').length, 6);
    assert.doesNotMatch(conversation.at(-1)?.text || '', /\?/);
    assert.throws(() => appendOfflineInterviewAnswer(conversation, 'Sixth answer'), /five/);
  }
});

test('cached WebLLM is a selectable stable engine and failure transitions once to fallback', () => {
  const selected = createOfflineInterviewActivityState('upcoming', 'CCIT', 'webllm');
  assert.equal(selected.offlineEngine, 'webllm');
  const failed = transitionOfflineInterviewToFallback(selected, 2, 'WebGPU device lost', 100);
  assert.equal(failed.offlineEngine, 'fallback');
  assert.equal(failed.engineTransitions.length, 1);
  assert.equal(failed.engineTransitions[0].atResponseCount, 2);
  assert.deepEqual(transitionOfflineInterviewToFallback(failed, 3, 'again'), failed);
});

test('fallback progression after two online answers continues at response three without repetition', () => {
  const pack = getEnrollmentInterviewQuestions('CCIT');
  const onlineConversation: ConversationTurn[] = [
    { sender: 'ai', text: 'Online question one?' },
    { sender: 'user', text: 'Online answer one' },
    { sender: 'ai', text: 'Online question two?' },
    { sender: 'user', text: 'Online answer two' },
    { sender: 'ai', text: 'Online question three?' },
  ];
  const third = appendOfflineInterviewAnswer(onlineConversation, 'Offline answer three');
  assert.equal(third.responseCount, 3);
  assert.equal(getFallbackProfessorTurn('upcoming', 'CCIT', third.responseCount), pack[3].text);
  assert.notEqual(pack[3].id, pack[0].id);
  assert.notEqual(pack[3].id, pack[1].id);
});

test('offline lock, stable IDs, question, transcript, and eye summary survive checkpoint restore', () => {
  const state = createOfflineInterviewActivityState('upcoming', 'CTE', 'fallback');
  const started = createActivityCheckpoint(8, {
    type: 'upcoming', mode: 'offline', questionPackVersion: ENROLLMENT_INTERVIEW_VERSION,
    currentQuestion: 'Saved question?', responseCount: 2,
    conversationLog: [{ sender: 'ai', text: 'Saved question?' }],
    eyeContactSummary: { score: 84, samples: 25 },
    activityState: state as unknown as Record<string, unknown>,
  }, 'offline', 'stable-interview-id');
  const restored = mergeActivityCheckpoint(started, { mode: 'online', currentStep: 3 });
  assert.equal(restored.mode, 'offline');
  assert.equal(restored.clientSessionId, 'stable-interview-id');
  assert.equal(restored.currentQuestion, 'Saved question?');
  assert.deepEqual(restored.eyeContactSummary, { score: 84, samples: 25 });
  assert.equal(readOfflineInterviewActivityState(restored)?.questionIds.length, 5);
});

test('bounded Thesis abstract context and its source survive safe resume', () => {
  const oversized = 'A'.repeat(MAX_THESIS_ABSTRACT_CONTEXT_LENGTH + 500);
  const state = createOfflineInterviewActivityState('thesis', 'CBAPA', 'fallback', {
    text: oversized,
    sourceName: 'proposal.pdf',
  });
  const session = createActivityCheckpoint(5, {
    type: 'thesis', mode: 'offline', questionPackVersion: THESIS_INTERVIEW_VERSION,
    activityState: state as unknown as Record<string, unknown>,
  }, 'offline', 'thesis-context');
  const restored = readOfflineInterviewActivityState(session);
  assert.equal(restored?.thesisAbstractContext?.length, MAX_THESIS_ABSTRACT_CONTEXT_LENGTH);
  assert.equal(restored?.thesisAbstractSourceName, 'proposal.pdf');
});

test('empty answers do not increment and five responses produce pending local evaluation without fake zeros', () => {
  assert.throws(() => appendOfflineInterviewAnswer([], '   '), /required/);
  const conversation = completeFallbackInterview('thesis', 'CBAPA');
  const provisional = evaluateOfflineInterview('thesis', conversation, { score: 91, samples: 20 });
  assert.equal(provisional.evaluation.responseCount, 5);
  assert.equal(provisional.evaluation.subjectiveScores, null);
  assert.equal(provisional.pendingEvaluation.subjectiveRubricScores, true);
  assert.equal(provisional.pendingEvaluation.finalScore, true);
  assert.ok(!('totalScore' in provisional.evaluation));
});

test('local completion must persist before pending sync and remains non-authoritative in analytics', () => {
  const active = createActivityCheckpoint(9, {
    type: 'upcoming', mode: 'offline', questionPackVersion: ENROLLMENT_INTERVIEW_VERSION,
  }, 'offline', 'completion-order');
  assert.throws(() => createPendingSyncCheckpoint(active), /safely persisted/);
  const completed = createCompletedLocalCheckpoint(active);
  const pending = createPendingSyncCheckpoint(completed);
  assert.equal(completed.status, 'completed_local');
  assert.equal(pending.status, 'pending_sync');
  assert.equal(isCompletedActivity({ status: pending.status, total_score: null }), false);
});

test('Enrollment, Thesis, context, and pending records remain account-isolated', () => {
  const records = [
    { userId: 1, type: 'upcoming', status: 'in_progress', mode: 'offline', updatedAt: 4, id: 'a-enroll' },
    { userId: 1, type: 'thesis', status: 'in_progress', mode: 'offline', updatedAt: 3, id: 'a-thesis' },
    { userId: 2, type: 'thesis', status: 'in_progress', mode: 'offline', updatedAt: 5, id: 'b-thesis' },
    { userId: 1, type: 'thesis', status: 'pending_sync', mode: 'offline', updatedAt: 2, id: 'a-pending' },
    { userId: 2, type: 'upcoming', status: 'pending_sync', mode: 'offline', updatedAt: 1, id: 'b-pending' },
  ];
  assert.deepEqual(selectOwnedResumableSessions(records, 1).map(record => record.id), ['a-enroll', 'a-thesis']);
  assert.deepEqual(selectOwnedResumableSessions(records, 2).map(record => record.id), ['b-thesis']);
  assert.deepEqual(selectOwnedSyncQueue(records, 1).map(record => record.id), ['a-pending']);
});

test('question-pack version mismatches refuse silent resume', () => {
  assert.equal(hasCurrentQuestionPack('upcoming', ENROLLMENT_INTERVIEW_VERSION), true);
  assert.equal(hasCurrentQuestionPack('thesis', THESIS_INTERVIEW_VERSION), true);
  assert.equal(hasCurrentQuestionPack('upcoming', 'enrollment-interview-v0'), false);
  assert.equal(hasCurrentQuestionPack('thesis', 'thesis-interview-v0'), false);
});

test('Dashboard keeps WebLLM out of normal startup and routes locked interviews locally', () => {
  const dashboard = readFileSync(new URL('../src/components/Dashboard.tsx', import.meta.url), 'utf8');
  const hook = readFileSync(new URL('../src/hooks/useWebLLM.ts', import.meta.url), 'utf8');
  assert.match(dashboard, /useWebLLM\([^\n]+, false\)/);
  assert.match(dashboard, /checkpoint\.mode === 'offline'/);
  assert.match(dashboard, /submitTypedInterviewAnswer/);
  assert.match(dashboard, /repeatStoredOfflineQuestion/);
  assert.match(hook, /hasModelInCache/);
  assert.match(hook, /availability !== 'cached_ready'/);
  assert.doesNotMatch(hook, /deleteModel(?:AllInfo|InCache)/);
});
