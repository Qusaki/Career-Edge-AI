import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { CameraTrackingNotice } from '../src/components/CameraTrackingNotice';

const readSource = (relativePath: string) => readFileSync(new URL(`../src/${relativePath}`, import.meta.url), 'utf8');

const cameraSource = readSource('components/CameraTrackingNotice.tsx');
const dashboardSource = readSource('components/Dashboard.tsx');
const preTestSource = readSource('components/PreTestPage.tsx');
const postTestSource = readSource('components/PostTestPage.tsx');
const eyeTrackerSource = readSource('hooks/useEyeContactTracker.ts');

const renderCamera = (status: 'tracking' | 'unavailable' | 'blocked') => renderToStaticMarkup(
  <CameraTrackingNotice
    videoRef={{ current: null }}
    status={status}
    score={75}
    samples={12}
  />,
);

test('the shared camera block is inline and compact instead of fixed to the viewport', () => {
  assert.doesNotMatch(cameraSource, /fixed|right-4|top-20|z-\[90\]/);
  assert.match(cameraSource, /w-full max-w-40 shrink-0/);
  assert.match(cameraSource, /aspect-video w-full/);
});

test('camera unavailable stays in the same compact preview slot with non-blocking copy', () => {
  const markup = renderCamera('unavailable');
  assert.match(markup, /Camera unavailable/);
  assert.match(markup, /Activity can continue without eye-contact scoring\./);
  assert.match(markup, /<video/);
  assert.match(markup, /role="status"/);
});

test('Who Am I and Active Listening place the shared camera inside the activity header', () => {
  const sectionStart = preTestSource.indexOf('<section className="flex-1 rounded-lg border border-line bg-card p-5">');
  const cameraPlacement = preTestSource.indexOf('<CameraTrackingNotice {...eyeTracker} />', sectionStart);
  const contentStart = preTestSource.indexOf('{(error || notice)', sectionStart);
  assert.ok(sectionStart >= 0 && cameraPlacement > sectionStart && cameraPlacement < contentStart);
});

test('Post-Test places the shared camera inside the activity header', () => {
  const sectionStart = postTestSource.indexOf('<section className="flex-1 rounded-lg border border-line bg-card p-5">');
  const cameraPlacement = postTestSource.indexOf('<CameraTrackingNotice {...eyeTracker} />', sectionStart);
  const contentStart = postTestSource.indexOf('{(error || notice)', sectionStart);
  assert.ok(sectionStart >= 0 && cameraPlacement > sectionStart && cameraPlacement < contentStart);
});

test('activity headers stack on mobile and align title with camera on wider screens', () => {
  for (const source of [preTestSource, postTestSource]) {
    assert.match(source, /mb-4 flex flex-col items-start gap-4 sm:flex-row sm:justify-between/);
  }
});

test('Enrollment and Thesis keep compact camera states inside the upper-right stage area', () => {
  assert.match(dashboardSource, /absolute right-3 top-3 z-20 w-36[\s\S]*?sm:top-4 sm:w-40/);
  assert.match(dashboardSource, /absolute left-4 right-4 top-14 z-20[\s\S]*?sm:top-4 sm:w-40/);
  assert.doesNotMatch(dashboardSource, /absolute bottom-4 right-4 z-20 w-44|absolute bottom-3 right-3 z-20 w-36/);
  assert.ok((dashboardSource.match(/Activity can continue without eye-contact scoring\./g) ?? []).length >= 2);
});

test('camera tracking state and score sampling logic remain authoritative in the existing hook', () => {
  assert.match(eyeTrackerSource, /navigator\.mediaDevices\.getUserMedia\([\s\S]*?video:/);
  assert.match(eyeTrackerSource, /landmarker\.detectForVideo\(video, performance\.now\(\)\)/);
  assert.match(eyeTrackerSource, /setSamples\(samplesRef\.current\)/);
  assert.match(eyeTrackerSource, /setScore\(Math\.round\(\(hitsRef\.current \/ samplesRef\.current\) \* 100\)\)/);
});
