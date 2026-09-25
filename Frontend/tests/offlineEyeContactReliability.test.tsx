import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { CameraTrackingNotice } from '../src/components/CameraTrackingNotice';
import { countEyeContactFrame, hasTrackableFace } from '../src/hooks/useEyeContactTracker';
import { combineEyeContactSummaries, shouldCheckpointEyeContact } from '../src/offline/eyeContact';
import { buildOfflineSyncPayload } from '../src/offline/offlineSyncClient';
import { createActivityCheckpoint } from '../src/offline/sessionFoundation';

const face = () => {
  const landmarks = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  landmarks[1] = { x: 0.5, y: 0.55 };
  landmarks[33] = { x: 0.4, y: 0.4 };
  landmarks[133] = { x: 0.45, y: 0.4 };
  landmarks[263] = { x: 0.6, y: 0.4 };
  landmarks[362] = { x: 0.55, y: 0.4 };
  landmarks[468] = { x: 0.425, y: 0.4 };
  landmarks[473] = { x: 0.575, y: 0.4 };
  landmarks[100] = { x: 0.38, y: 0.35 };
  landmarks[101] = { x: 0.62, y: 0.65 };
  return landmarks;
};

test('no face or invalid landmarks never become negative samples', () => {
  const empty = { hits: 0, samples: 0 };
  assert.equal(hasTrackableFace(undefined), false);
  assert.deepEqual(countEyeContactFrame(empty, undefined), empty);
  assert.deepEqual(countEyeContactFrame(empty, []), empty);
  const invalid = face();
  invalid[1] = { x: Number.NaN, y: 0.5 };
  assert.deepEqual(countEyeContactFrame(empty, invalid), empty);
});

test('valid face frames increment counters; genuine measured zero remains zero', () => {
  const centered = face();
  assert.equal(hasTrackableFace(centered), true);
  const positive = countEyeContactFrame({ hits: 0, samples: 0 }, centered);
  assert.deepEqual(positive, { hits: 1, samples: 1 });
  const lookingAway = face();
  lookingAway[1] = { x: 0.58, y: 0.55 };
  assert.deepEqual(countEyeContactFrame({ hits: 0, samples: 0 }, lookingAway), { hits: 0, samples: 1 });
  assert.deepEqual(combineEyeContactSummaries(null, { score: 0, samples: 1 }), { score: 0, samples: 1 });
});

test('zero valid samples display unavailable, while a measured zero displays 0%', () => {
  const withoutFace = renderToStaticMarkup(
    <CameraTrackingNotice videoRef={{ current: null }} status="tracking" score={0} samples={0} />,
  );
  const measuredZero = renderToStaticMarkup(
    <CameraTrackingNotice videoRef={{ current: null }} status="tracking" score={0} samples={1} />,
  );
  assert.match(withoutFace, /Detecting your face/);
  assert.doesNotMatch(withoutFace, /Eye-contact score: 0%/);
  assert.match(measuredZero, /Eye-contact score: 0%/);
  assert.deepEqual(combineEyeContactSummaries(null, { score: null, samples: 0 }), { score: null, samples: 0 });
  assert.deepEqual(combineEyeContactSummaries(null, { score: null, samples: 3 }), { score: null, samples: 0 });
});

test('offline checkpoint, resume, and sync preserve cumulative eye contact without fabricating missing scores', () => {
  const first = combineEyeContactSummaries(null, { score: 80, samples: 20 });
  const resumed = combineEyeContactSummaries(first, { score: 50, samples: 10 });
  assert.deepEqual(resumed, { score: 70, samples: 30 });
  const checkpoint = createActivityCheckpoint(7, {
    type: 'post_test',
    mode: 'offline',
    clientSessionId: 'offline-eye-reliability',
    questionPackVersion: 'post-test-v1',
    eyeContactSummary: resumed,
  }, 'offline', 'offline-eye-reliability');
  assert.deepEqual(buildOfflineSyncPayload(checkpoint).eye_contact_summary, resumed);
});

test('positive camera samples are saved periodically between answers without saving empty data', () => {
  assert.equal(shouldCheckpointEyeContact(0, 0), false);
  assert.equal(shouldCheckpointEyeContact(7, 0), false);
  assert.equal(shouldCheckpointEyeContact(8, 0), true);
  assert.equal(shouldCheckpointEyeContact(15, 8), false);
  assert.equal(shouldCheckpointEyeContact(16, 8), true);
  for (const page of ['Dashboard.tsx', 'PreTestPage.tsx', 'PostTestPage.tsx', 'DrillsPage.tsx']) {
    const source = readFileSync(new URL(`../src/components/${page}`, import.meta.url), 'utf8');
    assert.match(source, /shouldCheckpointEyeContact\(eyeTracker\.samples, eyeContactAutosaveRef\.current\.lastSamples\)/);
    assert.match(source, /eyeContactSummary: getCheckpointEyeContactSummary\(\)/);
  }
});

test('camera and detector failures remain non-blocking and do not create a score', () => {
  const unavailable = renderToStaticMarkup(
    <CameraTrackingNotice videoRef={{ current: null }} status="unavailable" score={0} samples={0} />,
  );
  assert.match(unavailable, /Activity can continue without eye-contact scoring/);
  const hook = readFileSync(new URL('../src/hooks/useEyeContactTracker.ts', import.meta.url), 'utf8');
  assert.match(hook, /video\.videoWidth <= 0 \|\| video\.videoHeight <= 0/);
  assert.match(hook, /setStatus\('unavailable'\)/);
  assert.match(hook, /if \(next\.samples === samplesRef\.current\) return/);
  assert.match(hook, /Eye-contact tracker failed to initialize:[\s\S]*?stream\?\.getTracks\(\)\.forEach\(track => track\.stop\(\)\)/);
});

test('MediaPipe JS, model, and WASM runtime assets are part of the offline build inputs', () => {
  const root = new URL('../', import.meta.url);
  for (const path of [
    'public/mediapipe/models/face_landmarker.task',
    'public/mediapipe/wasm/vision_wasm_internal.js',
    'public/mediapipe/wasm/vision_wasm_internal.wasm',
    'public/mediapipe/wasm/vision_wasm_nosimd_internal.js',
    'public/mediapipe/wasm/vision_wasm_nosimd_internal.wasm',
  ]) assert.equal(existsSync(new URL(path, root)), true, path);
  const vite = readFileSync(new URL('vite.config.ts', root), 'utf8');
  assert.match(vite, /globPatterns:[\s\S]*?js,css,html,ico,png,svg,json,wasm,task/);
  const hook = readFileSync(new URL('src/hooks/useEyeContactTracker.ts', root), 'utf8');
  assert.match(hook, /import\('@mediapipe\/tasks-vision'\)/);
  assert.match(hook, /publicAssetUrl\('mediapipe\/models\/face_landmarker\.task'\)/);
});
