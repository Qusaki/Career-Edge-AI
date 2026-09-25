import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/components/Dashboard.tsx', import.meta.url), 'utf8');
const interviewChoices = source.slice(
  source.indexOf("activeTab === 'interview-type' && ("),
  source.indexOf("activeTab === 'new-interview' && ("),
);
const choiceButton = (handler: string) => {
  const handlerIndex = interviewChoices.indexOf(handler);
  if (handlerIndex < 0) return '';
  const start = interviewChoices.lastIndexOf('<button', handlerIndex);
  const end = interviewChoices.indexOf('</button>', handlerIndex);
  return start < 0 || end < 0 ? '' : interviewChoices.slice(start, end + '</button>'.length);
};
const enrollmentChoice = choiceButton('onClick={startInterviewSession}');
const thesisChoice = choiceButton("onClick={() => { setThesisAbstractFile(null); setActiveTab('thesis-setup'); }}");
const enrollmentSession = source.slice(
  source.indexOf("activeTab === 'interview-session' && ("),
  source.indexOf('{/* Leave Confirmation Modal */}', source.indexOf("activeTab === 'interview-session' && (")),
);
const micButton = enrollmentSession.match(/<button\s+type="button"\s+onClick=\{toggleListening\}[\s\S]*?<\/button>/)?.[0];

test('University Enrollment choice shows a muted disabled state and no disabled hover effect', () => {
  assert.ok(enrollmentChoice);
  assert.match(enrollmentChoice, /disabled=\{isStartingInterview\}/);
  assert.match(enrollmentChoice, /isStartingInterview \? 'cursor-not-allowed opacity-60' : 'program-accent-hover-border group'/);
  assert.match(enrollmentChoice, /group-hover:scale-110/);
});

test('both interview-choice buttons use the visible shared focus treatment', () => {
  assert.ok(enrollmentChoice);
  assert.ok(thesisChoice);
  assert.match(enrollmentChoice, /program-accent-focus-ring/);
  assert.match(thesisChoice, /program-accent-focus-ring/);
});

test('Enrollment mic appearance and disabled prop share one complete authority', () => {
  assert.ok(micButton);
  const disabledDefinition = source.match(/const isEnrollmentMicDisabled = ([^;]+);/)?.[1];
  assert.ok(disabledDefinition);
  for (const condition of ['isMicTransitioning', 'isAiSpeaking', 'isSubmittingOfflineAnswer', 'enrollmentResponseCount >= 5']) {
    assert.ok(disabledDefinition.includes(condition), `${condition} must visibly disable the mic`);
  }
  assert.match(micButton, /disabled=\{isEnrollmentMicDisabled\}/);
  assert.match(micButton, /isEnrollmentMicDisabled\s*\? 'cursor-not-allowed[^']*bg-\[var\(--interview-disabled\)\][^']*'/);
  assert.match(micButton, /: isListening\s*\? 'program-accent-interview-active/);
});

test('Enrollment retains its idle MicOff and listening Mic icons', () => {
  assert.ok(micButton);
  assert.match(micButton, /\{isListening \? \([\s\S]*?<Mic className=[\s\S]*?\) : \([\s\S]*?<MicOff className=/);
  assert.match(micButton, /onClick=\{toggleListening\}/);
});
