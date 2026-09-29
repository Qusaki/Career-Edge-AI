import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { ConversationTurn } from '../src/db';
import { appendOfflinePostTestAnswer, getPostTestAnswerBoundary } from '../src/offline/activityRuntime';
import { getPostTestQuestions } from '../src/offline/questionPacks';

const source = readFileSync(new URL('../src/components/PostTestPage.tsx', import.meta.url), 'utf8');
const panelStart = source.indexOf('<div className="mt-4 flex min-h-44');
const panelEnd = source.indexOf('{(isListening || isFinalizing || hasUnfinalizedTranscript)', panelStart);
const panel = source.slice(panelStart, panelEnd);
const replayStart = panel.indexOf('<button');
const replayEnd = panel.indexOf('</button>', replayStart);
const replayButton = panel.slice(replayStart, replayEnd);
const historyStart = panel.indexOf('{visibleUserMessages.length > 0 && (');
const history = panel.slice(historyStart);

test('Replay Question stays in the active-question branch for Q1 through Q5', () => {
  assert.match(source, /if \(activeSession\) \{[\s\S]*?return \(/);
  assert.match(panel, /\{messages\.length === 0 \? \([\s\S]*?\) : \([\s\S]*?Replay Question/);
  assert.doesNotMatch(panel, /currentQuestionNumber\s*(?:===|!==|<=|>=|<|>)/);
  assert.match(replayButton, /onClick=\{replayLatestQuestion\}/);

  const questions = getPostTestQuestions('CCIT');
  let messages: ConversationTurn[] = [{ sender: 'ai', text: questions[0] }];
  for (let questionNumber = 1; questionNumber <= 5; questionNumber += 1) {
    assert.equal(messages.length > 0, true, `Q${questionNumber} has the replay render prerequisite`);
    assert.equal(messages[messages.length - 1]?.text, questions[questionNumber - 1]);
    assert.equal(getPostTestAnswerBoundary(messages).canAcceptAnswer, true);
    if (questionNumber < 5) {
      messages = appendOfflinePostTestAnswer(messages, `Answer ${questionNumber}`, questions).conversationLog;
    }
  }
});

test('long answer history scrolls independently below the replay control', () => {
  const questions = getPostTestQuestions('CCIT');
  let messages: ConversationTurn[] = [{ sender: 'ai', text: questions[0] }];
  for (let answerNumber = 1; answerNumber <= 3; answerNumber += 1) {
    messages = appendOfflinePostTestAnswer(messages, `Long answer ${answerNumber} `.repeat(100), questions).conversationLog;
  }
  assert.equal(messages.filter(message => message.sender === 'user').length, 3);
  assert.equal(messages[messages.length - 1]?.text, questions[3]);
  assert.ok(panelStart >= 0 && panelEnd > panelStart);
  assert.ok(replayStart >= 0 && replayEnd > replayStart && historyStart > replayEnd);
  assert.match(panel, /<div className="mt-4 flex min-h-44[^\"]*rounded-lg border border-line bg-background/);
  assert.doesNotMatch(panel.slice(0, panel.indexOf('>')), /overflow-y-auto|max-h-/);
  assert.match(history, /<div className="[^"]*max-h-80[^"]*overflow-y-auto[^"]*"/);
  assert.match(history, /visibleUserMessages\.map\(/);
});

test('replay retains its existing disabled guard and TTS-only handler', () => {
  assert.match(replayButton, /disabled=\{!latestAiQuestion \|\| isAiResponding \|\| isVoiceSpeaking\}/);
  const handler = source.match(/const replayLatestQuestion = \(\) => \{([\s\S]*?)\n  \};/)?.[1];
  assert.ok(handler);
  assert.match(handler, /if \(!latestAiQuestion\.trim\(\) \|\| isAiResponding \|\| isVoiceSpeaking\) return/);
  assert.match(handler, /speakText\(latestAiQuestion\)/);
  assert.doesNotMatch(handler, /setMessages|setRecordedAnswerCount|setLatestAiQuestion|sendReply|fetch\(|socket\.send/);
});

test('replay layout does not change the five-answer boundary or speech-only control', () => {
  assert.match(source, /recordedAnswerCount >= POST_TEST_ANSWER_LIMIT \|\| !answerBoundary\.canAcceptAnswer/);
  assert.match(source, /startListening\(transcript => void sendReply\(transcript, answerIndex\)/);
  assert.doesNotMatch(source, /<textarea\b|Or type your answer/);
});
