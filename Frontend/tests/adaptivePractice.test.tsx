import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { AdaptiveRecommendationCard, type Recommendation } from '../src/components/AdaptivePracticePage';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const adaptive = source('../src/components/AdaptivePracticePage.tsx');
const drills = source('../src/components/DrillsPage.tsx');

const recommendation: Recommendation = {
  scores: { clarity: 2.5 }, priority_criterion: 'clarity', difficulty: 'intermediate',
  confidence: 'limited', reason: 'Based on your available completed assessment.', maintenance: false,
};
const render = (value: Recommendation | null, online = true, loading = false, starting = false) =>
  renderToStaticMarkup(<AdaptiveRecommendationCard recommendation={value} effectiveOnline={online}
    loading={loading} starting={starting} onStart={() => undefined} />);

test('adaptive recommendation shows server target, difficulty, and reason without replacing canonical difficulty', () => {
  const html = render(recommendation);
  assert.match(html, /Focus.*Clarity/);
  assert.match(html, /Difficulty.*Intermediate/);
  assert.match(html, /Based on your available completed assessment/);
  assert.match(html, /Start Personalized Practice/);
  assert.match(drills, /AdaptivePracticePage/);
  assert.match(drills, /aria-label="Drill difficulty"/);
  assert.match(drills, /getDrillRemediationRecommendation/);
});

test('no evidence and maintenance have honest distinct language', () => {
  assert.match(render(null), /Complete an assessment to get a personalized recommendation/);
  assert.doesNotMatch(render(null), /Start Personalized Practice/);
  assert.match(render({ ...recommendation, maintenance: true }), /Maintenance Focus/);
});

test('offline adaptive entry is unavailable but canonical Drills remain available', () => {
  const html = render(recommendation, false);
  assert.match(html, /available when you&#x27;re online/);
  assert.match(html, /regular Drills offline/);
  assert.doesNotMatch(html, /Start Personalized Practice/);
  assert.match(drills, /getOfflineDrillPrompt/);
  assert.doesNotMatch(adaptive, /onActivityStart\(/);
});

test('generation is explicit, scoped, and double-start disabled', () => {
  assert.match(render(recommendation, true, true), /Loading your recommendation/);
  const starting = render(recommendation, true, false, true);
  assert.match(starting, /disabled=""/);
  assert.match(starting, /Generating practice/);
  assert.match(adaptive, /client_attempt_id: attemptIdRef.current/);
  assert.match(adaptive, /if \(!effectiveOnline \|\| !recommendation\?\.priority_criterion \|\| inFlightRef.current\) return/);
});

test('active adaptive response and history are separate from canonical Drills', () => {
  assert.match(adaptive, /Personalized Practice\{session.status === 'completed' \? ' Result'/);
  assert.match(adaptive, /Adaptive Practice History/);
  assert.match(adaptive, /isListening \? <Mic/);
  assert.match(adaptive, /<MicOff/);
  assert.match(adaptive, /isListening \|\| isFinalizing/);
  assert.match(adaptive, /Next Recommended Focus/);
  assert.match(drills, /Recent Drills/);
});
