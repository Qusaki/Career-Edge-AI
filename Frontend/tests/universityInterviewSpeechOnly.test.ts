import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/components/Dashboard.tsx', import.meta.url), 'utf8');
const inputStart = source.indexOf('const renderOfflineInterviewInput =');
const inputEnd = source.indexOf('const syncingSessions =', inputStart);
const inputSource = source.slice(inputStart, inputEnd);
const sessionStart = source.indexOf("activeTab === 'interview-session' && (");
const sessionEnd = source.indexOf('{/* Leave Confirmation Modal */}', sessionStart);
const sessionSource = source.slice(sessionStart, sessionEnd);

test('University Interview has no rendered typed-answer fallback on any viewport', () => {
  assert.ok(inputStart >= 0 && inputEnd > inputStart);
  assert.match(inputSource, /const isThesis = type === 'thesis'/);
  assert.match(inputSource, /isThesis \? 'Typed answer fallback' : 'Interview question'/);
  assert.match(inputSource, /\{isThesis && <form onSubmit=\{submitTypedInterviewAnswer\}/);
  assert.match(inputSource, /<input[\s\S]*?aria-label="Typed interview answer"[\s\S]*?aria-label="Submit typed answer"[\s\S]*?<\/form>\}/);
  assert.match(sessionSource, /renderOfflineInterviewInput\('upcoming'\)/);
  assert.doesNotMatch(sessionSource, /Typed answer fallback|Typed interview answer|Submit typed answer|Type your answer here/);
  assert.doesNotMatch(source, /Type your answer here/);
});

test('manual typed submission is thesis-only while speech keeps shared answer persistence', () => {
  assert.match(source, /const submitTypedInterviewAnswer = \(event: React\.FormEvent\) => \{\s*event\.preventDefault\(\);\s*if \(activeInterviewModeRef\.current !== 'thesis'\) return;/);
  assert.match(source, /startSpeechInput\(\s*transcript => \{\s*onlinePendingUserTextRef\.current = '';\s*void submitInterviewAnswer\(transcript\)/);
  assert.match(source, /renderOfflineInterviewInput\('thesis'\)/);
  assert.match(inputSource, /Repeat question/);
  assert.match(inputSource, /Review your most recent offline recording/);
  assert.match(source, /current\.type === 'upcoming'[\s\S]*?free up browser storage and retry/);
  assert.match(source, /current\.type === 'upcoming'[\s\S]*?retry the recording/);
});

test('University voice controls, transcript, and mobile Maxiel framing remain present', () => {
  assert.match(sessionSource, /<EnrollmentMobileCameraFraming \/>/);
  assert.match(sessionSource, /<ProfessorModel\s/);
  assert.match(sessionSource, /onClick=\{toggleListening\}/);
  assert.match(sessionSource, /userAudioData\.map\(\(height, i\)/);
  assert.match(sessionSource, /aria-label="Add an attachment"/);
  assert.match(sessionSource, /aria-label="Leave interview without validating"/);
  assert.match(sessionSource, /Interview Transcript/);
});
