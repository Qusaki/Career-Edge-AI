import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dashboardSource = readFileSync(new URL('../src/components/Dashboard.tsx', import.meta.url), 'utf8');
const sessionStart = dashboardSource.indexOf("activeTab === 'interview-session' && (");
const sessionEnd = dashboardSource.indexOf('{/* Leave Confirmation Modal */}', sessionStart);
const sessionSource = dashboardSource.slice(sessionStart, sessionEnd);

test('Enrollment mobile DOM order follows stage, controls, then transcript', () => {
  assert.ok(sessionStart >= 0 && sessionEnd > sessionStart);
  const stage = sessionSource.indexOf('{/* Primary 3D interview stage */}');
  const controls = sessionSource.indexOf('{/* Integrated meeting controls */}');
  const transcript = sessionSource.indexOf('{/* Docked transcript and evaluation panel */}');
  assert.ok(stage >= 0 && stage < controls && controls < transcript);
  assert.equal(sessionSource.match(/\{\/\* Integrated meeting controls \*\/\}/g)?.length, 1);
  assert.equal(sessionSource.match(/\{\/\* Docked transcript and evaluation panel \*\/\}/g)?.length, 1);
  assert.doesNotMatch(sessionSource, /className="order-[123]/);
});

test('Enrollment retains explicit desktop stage, controls, and right-column transcript placement', () => {
  assert.match(sessionSource, /lg:grid-cols-\[minmax\(0,1fr\)_clamp\(20rem,24vw,26rem\)\]/);
  assert.match(sessionSource, /lg:col-start-1 lg:row-start-1 lg:m-5 lg:min-h-0/);
  assert.match(sessionSource, /lg:col-start-1 lg:row-start-2 lg:grid-cols-/);
  assert.match(sessionSource, /lg:col-start-2 lg:row-span-2 lg:row-start-1/);
});

test('Enrollment reduces stage height only below the small-screen breakpoint', () => {
  assert.match(sessionSource, /min-h-\[40svh\]/);
  assert.match(sessionSource, /sm:min-h-\[48svh\]/);
  assert.match(sessionSource, /lg:min-h-0/);
});

test('Enrollment microphone remains an accessible off/on control without changing its handler', () => {
  assert.match(sessionSource, /onClick=\{toggleListening\}/);
  assert.match(sessionSource, /aria-pressed=\{isListening\}/);
  assert.match(sessionSource, /isListening \? \([\s\S]*?<Mic className=[\s\S]*?\) : \([\s\S]*?<MicOff className=/);
  assert.match(sessionSource, /focus-visible:outline-\[var\(--program-accent-on-dark\)\]/);
});

test('Enrollment preserves native Attach, Camera, and Leave buttons and an inset-safe mobile popover', () => {
  assert.match(sessionSource, /<button[\s\S]*?aria-label="Add an attachment"/);
  assert.match(sessionSource, /<button[\s\S]*?aria-label=\{isCameraEnabled \? 'Turn camera off'/);
  assert.match(sessionSource, /<button[\s\S]*?aria-label="Leave interview without validating"/);
  assert.match(sessionSource, /left-0 z-\[100\] w-48[\s\S]*?sm:left-1\/2 sm:-translate-x-1\/2/);
});
