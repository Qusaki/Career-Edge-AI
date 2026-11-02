import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const pages = [
  { file: 'PreTestPage.tsx', heading: 'Recent Pre-Tests', error: 'Unable to load pre-test sessions.' },
  { file: 'DrillsPage.tsx', heading: 'Recent Drills', error: 'Unable to load drill sessions.' },
  { file: 'PostTestPage.tsx', heading: 'Recent Post-Tests', error: 'Unable to load post-test sessions.' },
] as const;

for (const { file, heading, error } of pages) {
  const source = readFileSync(new URL(`../src/components/${file}`, import.meta.url), 'utf8');
  const loader = source.slice(source.indexOf('const loadSessions = useCallback('), source.indexOf('useEffect(() => { loadSessions(); }'));
  const section = source.slice(source.indexOf(`>${heading}</h2>`), source.indexOf('</section>', source.indexOf(`>${heading}</h2>`)));

  test(`${heading}: manual refresh has an explicit, accessible loading button and keeps rows visible`, () => {
    assert.match(source, /const \[isRefreshing, setIsRefreshing\] = useState\(false\)/);
    assert.match(section, /<button type="button" onClick=\{handleRefresh\} disabled=\{loading \|\| isRefreshing\}/);
    assert.match(section, /program-accent-focus-ring/);
    assert.match(section, /disabled:cursor-not-allowed disabled:opacity-60/);
    assert.match(section, /isRefreshing \? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" \/> : <RefreshCw aria-hidden="true"/);
    assert.match(section, /isRefreshing \? 'Refreshing\.\.\.' : 'Refresh'/);
    assert.match(section, /\{loading \? \([\s\S]*?Loading sessions/);
    assert.match(section, /sessions\.slice\(0, 8\)\.map\(session/);
    assert.doesNotMatch(section, /\{isRefreshing \? \([\s\S]*?Loading sessions/);
    assert.match(source, new RegExp(`flex flex-wrap items-center justify-between gap-2"[\\s\\S]*?>${heading}<\\/h2>`));
  });

  test(`${heading}: only manual refresh skips initial loading and duplicate requests`, () => {
    assert.match(loader, /const loadSessions = useCallback\(async \(manualRefresh = false\) =>/);
    assert.match(loader, /if \(!manualRefresh\) setLoading\(true\)/);
    assert.ok((loader.match(/if \(!manualRefresh\) setLoading\(false\)/g) ?? []).length >= 2);
    assert.match(source, /useEffect\(\(\) => \{ loadSessions\(\); \}, \[loadSessions\]\)/);
    assert.match(loader, /if \(loading \|\| refreshInFlightRef\.current\) return/);
    assert.match(loader, /refreshInFlightRef\.current = true;[\s\S]*?setIsRefreshing\(true\);[\s\S]*?await loadSessions\(true\)/);
    assert.match(loader, /finally \{\s*refreshInFlightRef\.current = false;\s*setIsRefreshing\(false\)/);
    assert.match(loader, /if \(!token\) \{\s*if \(!manualRefresh\) setLoading\(false\);\s*return;/);
  });

  test(`${heading}: failed refresh retains rows and existing error handling`, () => {
    assert.match(loader, /setSessions\(/);
    assert.match(loader, /catch \(err\) \{\s*setError\(err instanceof Error \? err\.message/);
    assert.ok(loader.includes(error));
    assert.doesNotMatch(loader, /catch \(err\) \{[\s\S]*?setSessions\(\[\]\)/);
    assert.match(loader, /finally \{\s*if \(!manualRefresh\) setLoading\(false\)/);
  });
}
