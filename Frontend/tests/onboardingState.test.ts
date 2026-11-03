import assert from 'node:assert/strict';
import test from 'node:test';

import {
  markOnboardingCompleted,
  markOnboardingPending,
  readOnboardingState,
  shouldAutoStartOnboarding,
} from '../src/utils/onboardingState';

const createStorage = (): Storage => {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => [...values.keys()][index] ?? null,
    removeItem: key => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
};

const canStart = (
  userId: number | null,
  isNewSignupSession: boolean,
  state: 'pending' | 'completed' | null,
  dashboardVisible = true,
  blocked = false,
) => shouldAutoStartOnboarding({ userId, isNewSignupSession, state, dashboardVisible, blocked });

test('verified new signup starts; ordinary login without pending state does not', () => {
  assert.equal(canStart(17, true, null), true);
  assert.equal(canStart(17, false, null), false);
  assert.equal(canStart(null, true, null), false);
  assert.equal(canStart(0, true, null), false);
  assert.equal(canStart(17, true, null, false), false);
  assert.equal(canStart(17, true, null, true, true), false);
});

test('pending state survives refresh or normal login, but completed state never auto-starts', () => {
  const storage = createStorage();
  assert.equal(markOnboardingPending(17, storage), true);
  assert.equal(readOnboardingState(17, storage), 'pending');
  assert.equal(canStart(17, false, readOnboardingState(17, storage)), true);
  assert.equal(markOnboardingCompleted(17, storage), true);
  assert.equal(canStart(17, true, readOnboardingState(17, storage)), false);
  assert.equal(canStart(17, false, readOnboardingState(17, storage)), false);
  markOnboardingPending(17, storage);
  assert.equal(readOnboardingState(17, storage), 'completed');
});

test('completion is versioned and isolated by verified backend user ID', () => {
  const storage = createStorage();
  markOnboardingPending(17, storage);
  markOnboardingCompleted(17, storage);
  assert.equal(readOnboardingState(18, storage), null);
  markOnboardingPending(18, storage);
  assert.equal(readOnboardingState(18, storage), 'pending');
  assert.equal(readOnboardingState(17, storage), 'completed');
  assert.equal(storage.key(0), 'career-edge:onboarding:v1:17');
  assert.equal(storage.key(1), 'career-edge:onboarding:v1:18');
});

test('manual replay does not require or reset a pending marker', () => {
  const storage = createStorage();
  markOnboardingCompleted(17, storage);
  assert.equal(canStart(17, false, readOnboardingState(17, storage)), false);
  assert.equal(readOnboardingState(17, storage), 'completed');
});

test('invalid identity or unavailable local storage fails safely', () => {
  const storage = createStorage();
  assert.equal(markOnboardingPending(-1, storage), false);
  assert.equal(markOnboardingCompleted(0, storage), false);
  assert.equal(readOnboardingState(-1, storage), null);
  assert.equal(storage.length, 0);
  const unavailableStorage = {
    ...storage,
    getItem: () => { throw new Error('Storage unavailable'); },
    setItem: () => { throw new Error('Storage unavailable'); },
  } as Storage;
  assert.equal(readOnboardingState(17, unavailableStorage), null);
  assert.equal(markOnboardingPending(17, unavailableStorage), false);
  assert.equal(markOnboardingCompleted(17, unavailableStorage), false);
});
