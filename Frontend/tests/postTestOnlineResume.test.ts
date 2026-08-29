import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mock, test } from 'node:test';

import {
  getInitialPostTestReplayText,
  resolveInitialPostTestReplay,
  type ChatMessage,
} from '../src/components/PostTestPage';
import {
  appendPostTestUserAnswer,
  getPostTestAnswerBoundary,
} from '../src/offline/activityRuntime';

class MockOnlinePostTestClient {
  readonly messages: ChatMessage[];
  readonly speak = mock.fn((text: string) => text);
  private initialReplayExpectedText: string | null;

  constructor(hydratedMessages: readonly ChatMessage[]) {
    this.messages = hydratedMessages.map(message => ({ ...message }));
    this.initialReplayExpectedText = getInitialPostTestReplayText(this.messages);
  }

  receiveInitialServerTurn(chunks: readonly string[]) {
    const resolution = resolveInitialPostTestReplay(
      this.initialReplayExpectedText,
      chunks.join(''),
    );
    this.initialReplayExpectedText = null;
    if (resolution.shouldAppend) {
      this.messages.push({ sender: 'ai', text: resolution.completedText });
    }
    if (resolution.completedText) this.speak(resolution.completedText);
    return resolution;
  }

  receiveLaterServerTurn(chunks: readonly string[]) {
    const completedText = chunks.join('').trim();
    if (!completedText) return;
    this.messages.push({ sender: 'ai', text: completedText });
    this.speak(completedText);
  }
}

const question = (number: number) => `Canonical question ${number}`;
const answer = (number: number) => `Answer ${number}`;

const buildCurrentQuestionHistory = (completedAnswers: number): ChatMessage[] => {
  const history: ChatMessage[] = [{ sender: 'ai', text: question(1) }];
  for (let answerNumber = 1; answerNumber <= completedAnswers; answerNumber += 1) {
    history.push({ sender: 'user', text: answer(answerNumber) });
    if (answerNumber < 5) {
      history.push({ sender: 'ai', text: question(answerNumber + 1) });
    }
  }
  return history;
};

test('fresh online Post-Test appends and speaks the first question once', () => {
  const client = new MockOnlinePostTestClient([]);
  const result = client.receiveInitialServerTurn(['Canonical ', 'question 1']);

  assert.equal(result.isHydratedReplay, false);
  assert.equal(client.messages.length, 1);
  assert.deepEqual(client.messages[0], { sender: 'ai', text: question(1) });
  assert.equal(client.speak.mock.callCount(), 1);
});

test('resume with one unanswered AI question keeps the hydrated question once', () => {
  const client = new MockOnlinePostTestClient([{ sender: 'ai', text: question(1) }]);
  const result = client.receiveInitialServerTurn([question(1)]);

  assert.equal(result.isHydratedReplay, true);
  assert.equal(result.shouldAppend, false);
  assert.deepEqual(client.messages, [{ sender: 'ai', text: question(1) }]);
});

test('resume after multiple turns does not change the hydrated message count', () => {
  const hydrated = buildCurrentQuestionHistory(2);
  const client = new MockOnlinePostTestClient(hydrated);

  client.receiveInitialServerTurn([question(3)]);

  assert.deepEqual(client.messages, hydrated);
  assert.equal(client.messages.length, 5);
});

test('resume with four answers keeps question five once and one answer slot', () => {
  const hydrated = buildCurrentQuestionHistory(4);
  const client = new MockOnlinePostTestClient(hydrated);

  client.receiveInitialServerTurn([question(5)]);

  assert.equal(client.messages.filter(message => message.text === question(5)).length, 1);
  const boundary = getPostTestAnswerBoundary(client.messages);
  assert.equal(boundary.answerCount, 4);
  assert.equal(boundary.canAcceptAnswer, true);
});

test('resume with five answers remains complete and rejects a sixth answer', () => {
  const hydrated = [
    ...buildCurrentQuestionHistory(5),
    { sender: 'ai', text: 'You have completed all five Post-Test questions.' },
  ] satisfies ChatMessage[];
  const client = new MockOnlinePostTestClient(hydrated);

  client.receiveInitialServerTurn(['You have completed all five Post-Test questions.']);

  const boundary = getPostTestAnswerBoundary(client.messages);
  assert.equal(boundary.answerCount, 5);
  assert.equal(boundary.canAcceptAnswer, false);
  assert.throws(() => appendPostTestUserAnswer(client.messages, 'Answer 6'));
});

test('chunked initial WebSocket replay matching the hydrated question is not appended', () => {
  const client = new MockOnlinePostTestClient([{ sender: 'ai', text: question(1) }]);

  const result = client.receiveInitialServerTurn(['Canonical ', 'question ', '1']);

  assert.equal(result.isHydratedReplay, true);
  assert.equal(client.messages.length, 1);
});

test('resumed current question has one TTS playback without duplicate state insertion', () => {
  const client = new MockOnlinePostTestClient([{ sender: 'ai', text: question(1) }]);

  client.receiveInitialServerTurn([question(1)]);

  assert.equal(client.speak.mock.callCount(), 1);
  assert.deepEqual(client.speak.mock.calls[0].arguments, [question(1)]);
  assert.equal(client.messages.length, 1);
});

test('a legitimate later AI message still appends even when its text repeats', () => {
  const client = new MockOnlinePostTestClient([{ sender: 'ai', text: question(1) }]);
  client.receiveInitialServerTurn([question(1)]);

  client.receiveLaterServerTurn([question(1)]);

  assert.equal(client.messages.length, 2);
  assert.equal(client.messages.filter(message => message.text === question(1)).length, 2);
  assert.equal(client.speak.mock.callCount(), 2);
});

test('PostTestPage limits replay reconciliation to the initial buffered server turn', () => {
  const source = readFileSync(new URL('../src/components/PostTestPage.tsx', import.meta.url), 'utf8');

  assert.match(source, /initialReplayExpectedTextRef\.current = getInitialPostTestReplayText|const initialReplayExpectedText = getInitialPostTestReplayText/);
  assert.match(source, /if \(initialReplayExpectedTextRef\.current !== null\) return;/);
  assert.match(source, /initialReplayExpectedTextRef\.current = null;/);
  assert.match(source, /initialReplayExpectedText !== null && replayResolution\.shouldAppend/);
});
