import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('../src/components/DrillsPage.tsx', import.meta.url),
  'utf8',
);
const startFlow = source.slice(source.indexOf('const startDrill ='), source.indexOf('const quitDrill ='));
const loadFlow = source.slice(source.indexOf('const loadSessions ='), source.indexOf('useEffect(() => { loadSessions();'));

test('missing online token reports an expired session before any start request and clears Starting', () => {
  assert.match(startFlow, /const token = localStorage\.getItem\('token'\);\s*if \(!token\) throw new Error\('Your session has expired\. Please sign in again\.'\);\s*const sessionResponse = await fetch\(`\$\{apiUrl\}\/drills\/start`/);
  assert.match(startFlow, /catch \(err\) \{[\s\S]*?setError\(err instanceof Error \? err\.message/);
  assert.match(startFlow, /finally \{\s*if \(exerciseGenerationRef\.current === attemptId\) setStarting\(null\)/);
  assert.match(source, /\{\(error \|\| notice\) && \(/);
});

test('missing token during Drill list loading clears the loading state', () => {
  assert.match(loadFlow, /const token = localStorage\.getItem\('token'\);\s*if \(!token\) \{\s*if \(!manualRefresh\) setLoading\(false\);\s*return;\s*\}/);
  assert.match(loadFlow, /finally \{\s*if \(!manualRefresh\) setLoading\(false\)/);
});

test('valid-token online start, offline start, guards, resume, and replay paths remain intact', () => {
  assert.match(startFlow, /if \(!levelProgress\.unlocked\)/);
  assert.match(startFlow, /if \(!drillProgress\?\.unlocked\)/);
  assert.match(startFlow, /if \(!effectiveOnline\) \{[\s\S]*?mode: 'offline'/);
  assert.match(startFlow, /Authorization: `Bearer \$\{token\}`/);
  assert.match(startFlow, /const session: DrillSession = await sessionResponse\.json\(\)/);
  assert.match(startFlow, /setActiveSession\(session\)/);
  assert.match(source, /disabled=\{isDrillLocked \|\| starting !== null \|\| completing !== null\}/);
  assert.match(source, /isCompleted \? 'Replay Drill' : 'Start Drill'/);
});

test('Drill progression is loaded from the authenticated backend endpoint', () => {
  assert.match(source, /fetch\(`\$\{apiUrl\}\/drills\/progress`, \{ headers \}\)/);
  assert.match(source, /setProgress\(progressData\)/);
});

test('post-completion refresh keeps both requests parallel and cannot resend scoring on refresh failure', () => {
  const completionStart = source.indexOf('const completeDrill = async () =>');
  const completion = source.slice(completionStart, source.indexOf('if (activeSession) {', completionStart));
  assert.match(loadFlow, /const \[sessionsResponse, progressResponse\] = await Promise\.all\(\[/);
  assert.match(loadFlow, /catch \(err\) \{\s*setError\(/);
  assert.equal((completion.match(/\/drills\/\$\{serverSessionId\}\/complete/g) ?? []).length, 1);
  assert.match(completion, /setCompletionPhase\('refreshing'\);[\s\S]*?await loadSessions\(\)/);
  assert.match(completion, /finally \{\s*completionInFlightRef\.current = false;[\s\S]*?setCompletionPhase\('idle'\)/);
});

test('canonical level groups keep Positive Framing in Medium and preserve exact order', () => {
  assert.match(source, /easy:\s*\['jam',\s*'fast_word'\]/);
  assert.match(source, /medium:\s*\['emotion',\s*'synonym',\s*'fake_profile',\s*'emoji_story',\s*'positive_framing'\]/);
  assert.match(source, /hard:\s*\['taboo',\s*'elevator_pitch',\s*'rephrase',\s*'negotiation',\s*'crisis'\]/);
  assert.match(source, /const levelDrills = drillTypesByLevel\[level\]\.map\(getDrillDefinition\)/);
});

test('safe initial progression unlocks only JAM for a new user', () => {
  assert.match(source, /const levelUnlocked = level === 'easy'/);
  assert.match(source, /unlocked: levelUnlocked && index === 0/);
  assert.match(source, /easy: createInitialLevelProgress\('easy'\)/);
  assert.match(source, /medium: createInitialLevelProgress\('medium'\)/);
  assert.match(source, /hard: createInitialLevelProgress\('hard'\)/);
});

test('locked levels remain visible with clear lock guidance', () => {
  assert.match(source, /<Lock className=/);
  assert.match(source, /Complete all Beginner drills to unlock Intermediate\./);
  assert.match(source, /Complete all Intermediate drills to unlock Advanced\./);
});

test('difficulty selector begins unselected and renders only the chosen canonical group', () => {
  assert.match(source, /const \[selectedLevel, setSelectedLevel\] = useState<DrillLevel \| null>\(null\)/);
  assert.match(source, /selectedLevel === null && <p[^>]*>Choose a difficulty level to view available Drills\.<\/p>/);
  assert.match(source, /selectedLevel !== null && drillLevels\.filter\(level => level === selectedLevel\)\.map\(level =>/);
  assert.match(source, /easy: \['jam', 'fast_word'\]/);
  assert.match(source, /medium: \['emotion', 'synonym', 'fake_profile', 'emoji_story', 'positive_framing'\]/);
  assert.match(source, /hard: \['taboo', 'elevator_pitch', 'rephrase', 'negotiation', 'crisis'\]/);
});

test('difficulty buttons expose selection without starting a Drill or disabling locked levels', () => {
  const selector = source.slice(source.indexOf('<section aria-label="Drill difficulty"'), source.indexOf('<section className="space-y-4" aria-label="Drills by difficulty"'));
  assert.match(selector, /drillLevels\.map\(level => \(/);
  assert.match(selector, /type="button" onClick=\{\(\) => setSelectedLevel\(level\)\}/);
  assert.match(selector, /aria-pressed=\{selectedLevel === level\}/);
  assert.match(selector, /program-accent-focus-ring min-h-11/);
  assert.match(selector, /flex flex-wrap gap-2/);
  assert.doesNotMatch(selector, /startDrill|disabled=|fetch\(|getUserMedia|startListening|speakText/);
  assert.match(source, /disabled=\{isDrillLocked \|\| starting !== null \|\| completing !== null\}/);
});

test('difficulty labels are presentation-only and survive Back to Drills on the same mount', () => {
  assert.match(source, /easy: 'Beginner'/);
  assert.match(source, /medium: 'Intermediate'/);
  assert.match(source, /hard: 'Advanced'/);
  assert.match(source, /\{drillLevelLabels\[level\]\}<\/h2>/);
  assert.match(source, /drillLevelLabels\[activeSession\.drill_level as DrillLevel\]/);
  assert.match(source, /onDone=\{\(\) => \{\s*setCompletionResult\(null\);\s*setError\(null\);/);
  assert.doesNotMatch(source, /setSelectedLevel\(null\)/);
  assert.match(source, /drillLevel: 'easy'/);
  assert.match(source, /drillLevel: 'medium'/);
  assert.match(source, /drillLevel: 'hard'/);
});

test('locked drills show the immediate prerequisite returned by progression state', () => {
  assert.match(source, /Complete \$\{drillUnlockNames\[drillProgress\.prerequisite_type\]\} first to unlock\./);
  assert.match(source, /isDrillLocked && <p[^>]*>\{lockedCopy\}<\/p>/);
  assert.match(source, /aria-label=\{isDrillLocked \? `\$\{drill\.title\} is locked\. \$\{lockedCopy\}`/);
});

test('each level displays authoritative completion counts', () => {
  assert.match(source, /\{levelProgress\.completed\} \/ \{levelProgress\.total\} drills completed/);
});

test('individual completed Drill types are visibly marked', () => {
  assert.match(source, /levelProgress\.drills\.find\(item => item\.type === drill\.drillType\)/);
  assert.match(source, /const isCompleted = Boolean\(drillProgress\?\.completed\)/);
  assert.match(source, /isCompleted \? 'Previously completed' : isDrillLocked \? 'Locked' : 'Available'/);
  assert.doesNotMatch(source, /isCompleted \? 'Completed' : isDrillLocked/);
});

test('a previously completed Drill type can show a separate Active replay session', () => {
  assert.match(source, /const isCompleted = Boolean\(drillProgress\?\.completed\)/);
  assert.match(source, /isCompleted \? 'Previously completed' : isDrillLocked \? 'Locked' : 'Available'/);
  assert.match(source, /sessions\.slice\(0, 8\)\.map\(session =>/);
  assert.match(source, /\{session\.status\}<\/span>/);
  assert.match(source, /isCompleted \? 'Replay Drill' : 'Start Drill'/);
  assert.doesNotMatch(source, /disabled=\{[^}]*isCompleted/);
});

test('locked Drill actions cannot start a session', () => {
  assert.match(source, /disabled=\{isDrillLocked \|\| starting !== null \|\| completing !== null\}/);
  assert.match(source, /if \(!levelProgress\.unlocked\)/);
  assert.match(source, /if \(!drillProgress\?\.unlocked\)/);
});

test('server lock errors use the shared API error normalizer', () => {
  assert.match(source, /normalizeApiError\(body, `Unable to start \$\{drill\.title\}\.`\)/);
});

test('online completion refreshes authoritative progression immediately', () => {
  assert.match(source, /setCompletionResult\(createDrillCompletionResult\([\s\S]*?await loadSessions\(\)/);
});

test('completed Drill types remain replayable', () => {
  assert.match(source, /isCompleted \? 'Replay Drill' : 'Start Drill'/);
  assert.doesNotMatch(source, /disabled=\{[^}]*isCompleted/);
});

test('offline starts use the same current server-authoritative lock state', () => {
  const guardIndex = source.indexOf('if (!drillProgress?.unlocked)');
  const offlineIndex = source.indexOf('if (!effectiveOnline)', guardIndex);
  assert.ok(guardIndex >= 0 && offlineIndex > guardIndex);
});
