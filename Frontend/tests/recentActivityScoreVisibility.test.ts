import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readComponent = (name: string) => readFileSync(new URL(`../src/components/${name}`, import.meta.url), 'utf8');

const recentSection = (source: string, heading: string) => {
  const start = source.indexOf(`<h2 className="text-lg font-bold italic tracking-tight text-ink">${heading}</h2>`);
  assert.notEqual(start, -1, `${heading} heading must remain`);
  const end = source.indexOf('</section>', start);
  assert.notEqual(end, -1, `${heading} section must remain`);
  return source.slice(start, end);
};

const preTest = readComponent('PreTestPage.tsx');
const drills = readComponent('DrillsPage.tsx');
const postTest = readComponent('PostTestPage.tsx');

test('recent Pre-Tests keep activity, date, and status without displaying a score', () => {
  const section = recentSection(preTest, 'Recent Pre-Tests');
  assert.match(section, /\{session\.exercise\}/);
  assert.match(section, /new Date\(session\.start_time\)\.toLocaleString\(\)/);
  assert.match(section, /\{session\.status\}/);
  assert.doesNotMatch(section, /session\.(?:total_score|score_eye_contact|eye_contact_samples)/);
  assert.doesNotMatch(section, /\/[12]5\b/);
});

test('recent Drills keep activity, date, and status without displaying a score', () => {
  const section = recentSection(drills, 'Recent Drills');
  assert.match(section, /session\.drill_type\.replace\(/);
  assert.match(section, /new Date\(session\.start_time\)\.toLocaleString\(\)/);
  assert.match(section, /\{session\.status\}/);
  assert.doesNotMatch(section, /session\.score\b|Math\.round\(session\.score\)/);
});

test('recent Post-Tests keep activity, date, and status without displaying a score', () => {
  const section = recentSection(postTest, 'Recent Post-Tests');
  assert.match(section, /Post-Test[^\n]*Question \{session\.question_number \|\| 1\} of 5/);
  assert.match(section, /new Date\(session\.start_time\)\.toLocaleString\(\)/);
  assert.match(section, /\{session\.status\}/);
  assert.doesNotMatch(section, /session\.(?:total_score|score_eye_contact|eye_contact_samples)/);
  assert.doesNotMatch(section, /\/25\b/);
});

test('score data contracts remain while recent rows keep their compact responsive layout', () => {
  assert.match(preTest, /total_score\?: number \| null/);
  assert.match(drills, /score\?: number \| null/);
  assert.match(postTest, /total_score\?: number \| null/);
  for (const [source, heading] of [
    [preTest, 'Recent Pre-Tests'],
    [drills, 'Recent Drills'],
    [postTest, 'Recent Post-Tests'],
  ] as const) {
    const section = recentSection(source, heading);
    assert.match(section, /flex items-center justify-between border-b border-line px-4 py-3 last:border-b-0/);
    assert.match(section, /program-accent-surface rounded-full px-2\.5 py-1 text-xs font-bold capitalize/);
    assert.doesNotMatch(section, /className="mt-1 text-sm font-bold text-ink"/);
  }
});
