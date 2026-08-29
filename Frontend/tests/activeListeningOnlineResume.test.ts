import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mock, test } from 'node:test';

import {
  getInitialActiveListeningReplay,
  getVisibleActiveListeningMessages,
  resolveInitialActiveListeningReplay,
  type PreTestChatMessage,
} from '../src/components/PreTestPage';

class MockActiveListeningClient {
  readonly messages: PreTestChatMessage[];
  readonly speak = mock.fn((text: string) => text);
  private initialReplay: PreTestChatMessage | null;

  constructor(hydratedMessages: readonly PreTestChatMessage[]) {
    this.messages = hydratedMessages.map(message => ({ ...message }));
    this.initialReplay = getInitialActiveListeningReplay(this.messages);
  }

  receiveInitialServerTurn(chunks: readonly string[], messageId: number | null) {
    const resolution = resolveInitialActiveListeningReplay(
      this.initialReplay,
      messageId,
      chunks.join(''),
    );
    this.initialReplay = null;
    if (resolution.shouldAppend) {
      this.messages.push({
        id: messageId ?? undefined,
        sender: 'ai',
        text: resolution.completedText,
      });
    }
    if (resolution.completedText) this.speak(resolution.completedText);
    return resolution;
  }

  receiveLaterServerTurn(chunks: readonly string[], messageId: number) {
    const completedText = chunks.join('').trim();
    if (!completedText) return;
    this.messages.push({ id: messageId, sender: 'ai', text: completedText });
    this.speak(completedText);
  }
}

const storedConversation: PreTestChatMessage[] = [
  { id: 1, sender: 'ai', text: 'Canonical listening story' },
  { id: 2, sender: 'user', text: 'My stored summary' },
  { id: 3, sender: 'ai', text: 'Stored AI feedback' },
];

test('existing online Active Listening history hydrates in canonical server order', () => {
  const client = new MockActiveListeningClient(storedConversation);

  assert.deepEqual(client.messages, storedConversation);
  assert.deepEqual(client.messages.map(message => message.id), [1, 2, 3]);
});

test('hydrated user responses remain visible after refresh', () => {
  const visibleMessages = getVisibleActiveListeningMessages(storedConversation);

  assert.equal(visibleMessages.some(message => message.text === 'My stored summary'), true);
});

test('hydrated AI feedback remains visible while the listening story stays audio-only', () => {
  const visibleMessages = getVisibleActiveListeningMessages(storedConversation);

  assert.equal(visibleMessages.some(message => message.text === 'Stored AI feedback'), true);
  assert.equal(visibleMessages.some(message => message.text === 'Canonical listening story'), false);
});

test('WebSocket reconnect does not append the hydrated latest AI message again', () => {
  const client = new MockActiveListeningClient(storedConversation);

  const resolution = client.receiveInitialServerTurn(['Stored ', 'AI feedback'], 3);

  assert.equal(resolution.isHydratedReplay, true);
  assert.equal(resolution.shouldAppend, false);
  assert.deepEqual(client.messages, storedConversation);
  assert.equal(client.speak.mock.callCount(), 1);
});

test('a new AI message after resume appends normally', () => {
  const client = new MockActiveListeningClient(storedConversation);
  client.receiveInitialServerTurn(['Stored AI feedback'], 3);

  client.receiveLaterServerTurn(['New ', 'follow-up feedback'], 5);

  assert.equal(client.messages.length, 4);
  assert.deepEqual(client.messages[3], {
    id: 5,
    sender: 'ai',
    text: 'New follow-up feedback',
  });
});

test('fresh Active Listening appends and speaks its initial prompt normally', () => {
  const client = new MockActiveListeningClient([]);

  const resolution = client.receiveInitialServerTurn(['Fresh listening story'], 1);

  assert.equal(resolution.isHydratedReplay, false);
  assert.deepEqual(client.messages, [{ id: 1, sender: 'ai', text: 'Fresh listening story' }]);
  assert.equal(client.speak.mock.callCount(), 1);
});

test('stable message IDs allow legitimate identical later text', () => {
  const client = new MockActiveListeningClient([
    { id: 3, sender: 'ai', text: 'Repeated feedback' },
  ]);

  const resolution = client.receiveInitialServerTurn(['Repeated feedback'], 4);

  assert.equal(resolution.isHydratedReplay, false);
  assert.equal(client.messages.length, 2);
  assert.deepEqual(client.messages.map(message => message.id), [3, 4]);
});

test('PreTestPage hydrates server history before connecting and guards one online submission', () => {
  const source = readFileSync(new URL('../src/components/PreTestPage.tsx', import.meta.url), 'utf8');
  const hydrationIndex = source.indexOf('const sessionDetailResponse = await fetch');
  const connectionIndex = source.indexOf('connectActiveListeningChat(session);');

  assert.ok(hydrationIndex >= 0);
  assert.ok(connectionIndex > hydrationIndex);
  assert.match(source, /initialActiveListeningReplayRef\.current = getInitialActiveListeningReplay/);
  assert.match(source, /if \(initialActiveListeningReplayRef\.current !== null\) return;/);
  assert.match(source, /answerSubmissionInFlightRef\.current/);
  assert.match(source, /disabled=\{connectionState !== 'ready' \|\| isAiResponding \|\| isVoiceSpeaking \|\| isSubmittingAnswer\}/);
});
