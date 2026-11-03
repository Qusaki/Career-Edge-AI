import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bindNewSignupToVerifiedUser,
  clearNewSignupHandoff,
  hasNewSignupHandoff,
  isOnboardingInspectionPending,
  isOnboardingOfflineErrorBlocking,
  markOnboardingCompleted,
  markOnboardingPending,
  readOnboardingState,
  recordAuthenticationEntry,
  rememberNewSignupHandoff,
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

test('successful signup handoff binds pending only after the verified account ID arrives', () => {
  const accountStorage = createStorage();
  const handoffStorage = createStorage();
  assert.equal(rememberNewSignupHandoff(handoffStorage), true);
  assert.equal(hasNewSignupHandoff(handoffStorage), true);
  assert.equal(accountStorage.length, 0);
  assert.equal(handoffStorage.key(0), 'career-edge:onboarding:new-signup:v1');
  assert.equal(handoffStorage.getItem(handoffStorage.key(0)!), 'pending-verification');
  assert.equal(bindNewSignupToVerifiedUser(17, true, accountStorage, handoffStorage), 'pending');
  assert.equal(readOnboardingState(17, accountStorage), 'pending');
  assert.equal(hasNewSignupHandoff(handoffStorage), false);
});

test('a full App remount can bind the tab handoff with a reset in-memory signup flag', () => {
  const accountStorage = createStorage();
  const handoffStorage = createStorage();
  rememberNewSignupHandoff(handoffStorage);
  assert.equal(bindNewSignupToVerifiedUser(17, false, accountStorage, handoffStorage), 'pending');
  assert.equal(readOnboardingState(17, accountStorage), 'pending');
  assert.equal(canStart(17, false, readOnboardingState(17, accountStorage), true, true), false);
  assert.equal(canStart(17, false, readOnboardingState(17, accountStorage), true, false), true);
});

test('normal login and logout clear stale unbound handoffs before another account verifies', () => {
  const accountStorage = createStorage();
  const handoffStorage = createStorage();
  rememberNewSignupHandoff(handoffStorage);
  assert.equal(recordAuthenticationEntry(false, handoffStorage), false);
  assert.equal(bindNewSignupToVerifiedUser(18, false, accountStorage, handoffStorage), 'not-applicable');
  assert.equal(readOnboardingState(18, accountStorage), null);
  rememberNewSignupHandoff(handoffStorage);
  clearNewSignupHandoff(handoffStorage);
  assert.equal(hasNewSignupHandoff(handoffStorage), false);
});

test('completed and pending accounts consume a handoff without overwriting account state', () => {
  const accountStorage = createStorage();
  const handoffStorage = createStorage();
  markOnboardingCompleted(17, accountStorage);
  rememberNewSignupHandoff(handoffStorage);
  assert.equal(bindNewSignupToVerifiedUser(17, false, accountStorage, handoffStorage), 'completed');
  assert.equal(readOnboardingState(17, accountStorage), 'completed');
  assert.equal(hasNewSignupHandoff(handoffStorage), false);
  markOnboardingPending(18, accountStorage);
  rememberNewSignupHandoff(handoffStorage);
  assert.equal(bindNewSignupToVerifiedUser(18, false, accountStorage, handoffStorage), 'pending');
  assert.equal(readOnboardingState(18, accountStorage), 'pending');
  assert.equal(readOnboardingState(17, accountStorage), 'completed');
  assert.equal(hasNewSignupHandoff(handoffStorage), false);
});

test('failed account persistence keeps the handoff for a later retry without crashing', () => {
  const handoffStorage = createStorage();
  const unavailableAccountStorage = {
    ...createStorage(),
    getItem: () => { throw new Error('Storage unavailable'); },
    setItem: () => { throw new Error('Storage unavailable'); },
  } as Storage;
  rememberNewSignupHandoff(handoffStorage);
  assert.equal(bindNewSignupToVerifiedUser(17, false, unavailableAccountStorage, handoffStorage), 'storage-unavailable');
  assert.equal(hasNewSignupHandoff(handoffStorage), true);
  assert.equal(bindNewSignupToVerifiedUser(17, false, createStorage(), handoffStorage), 'pending');
  assert.equal(hasNewSignupHandoff(handoffStorage), false);
});

test('sessionStorage failure is graceful and in-memory signup can still bind', () => {
  const accountStorage = createStorage();
  const unavailableHandoffStorage = {
    ...createStorage(),
    getItem: () => { throw new Error('Storage unavailable'); },
    setItem: () => { throw new Error('Storage unavailable'); },
    removeItem: () => { throw new Error('Storage unavailable'); },
  } as Storage;
  assert.equal(rememberNewSignupHandoff(unavailableHandoffStorage), false);
  assert.equal(hasNewSignupHandoff(unavailableHandoffStorage), false);
  assert.equal(clearNewSignupHandoff(unavailableHandoffStorage), false);
  assert.equal(recordAuthenticationEntry(true, unavailableHandoffStorage), true);
  assert.equal(bindNewSignupToVerifiedUser(17, true, accountStorage, unavailableHandoffStorage), 'pending');
  assert.equal(readOnboardingState(17, accountStorage), 'pending');
});

test('blocked browser storage getters cannot crash authentication or the Dashboard', () => {
  const originalSessionStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    get: () => { throw new Error('sessionStorage blocked'); },
  });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get: () => { throw new Error('localStorage blocked'); },
  });
  try {
    assert.equal(recordAuthenticationEntry(true), true);
    assert.equal(clearNewSignupHandoff(), false);
    assert.equal(readOnboardingState(17), null);
    assert.equal(markOnboardingPending(17), false);
    assert.equal(markOnboardingCompleted(17), false);
    assert.equal(bindNewSignupToVerifiedUser(17, true), 'storage-unavailable');
  } finally {
    if (originalSessionStorage) Object.defineProperty(globalThis, 'sessionStorage', originalSessionStorage);
    else Reflect.deleteProperty(globalThis, 'sessionStorage');
    if (originalLocalStorage) Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('offline inspection blocks only while unresolved, including on a different account', () => {
  assert.equal(isOnboardingInspectionPending(17, null, null), true);
  assert.equal(isOnboardingInspectionPending(17, 17, null), false);
  assert.equal(isOnboardingInspectionPending(17, null, 17), false);
  assert.equal(isOnboardingInspectionPending(18, 17, null), true);
  const inspectionError = 'Saved offline activities could not be inspected safely.';
  assert.equal(isOnboardingOfflineErrorBlocking(inspectionError, 17, 17, inspectionError), false);
  assert.equal(isOnboardingOfflineErrorBlocking(inspectionError, 18, 17, inspectionError), true);
  assert.equal(isOnboardingOfflineErrorBlocking('A different offline error', 17, 17, inspectionError), true);
});
