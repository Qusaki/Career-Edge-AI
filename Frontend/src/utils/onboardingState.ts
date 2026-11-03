export type OnboardingState = 'pending' | 'completed' | null;

const ONBOARDING_KEY_PREFIX = 'career-edge:onboarding:v1:';
const NEW_SIGNUP_HANDOFF_KEY = 'career-edge:onboarding:new-signup:v1';

export const rememberNewSignupHandoff = (storage?: Storage): boolean => {
  try {
    (storage ?? sessionStorage).setItem(NEW_SIGNUP_HANDOFF_KEY, 'pending-verification');
    return true;
  } catch {
    return false;
  }
};

export const hasNewSignupHandoff = (storage?: Storage): boolean => {
  try {
    return (storage ?? sessionStorage).getItem(NEW_SIGNUP_HANDOFF_KEY) === 'pending-verification';
  } catch {
    return false;
  }
};

export const clearNewSignupHandoff = (storage?: Storage): boolean => {
  try {
    (storage ?? sessionStorage).removeItem(NEW_SIGNUP_HANDOFF_KEY);
    return true;
  } catch {
    return false;
  }
};

export const recordAuthenticationEntry = (isNewSignup: boolean, storage?: Storage): boolean => {
  if (isNewSignup) rememberNewSignupHandoff(storage);
  else clearNewSignupHandoff(storage);
  return isNewSignup;
};

const keyForUser = (userId: number): string => {
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new Error('A verified user ID is required for onboarding.');
  }
  return `${ONBOARDING_KEY_PREFIX}${userId}`;
};

export const readOnboardingState = (userId: number, storage?: Storage): OnboardingState => {
  try {
    const value = (storage ?? localStorage).getItem(keyForUser(userId));
    return value === 'pending' || value === 'completed' ? value : null;
  } catch {
    return null;
  }
};

export const markOnboardingPending = (userId: number, storage?: Storage): boolean => {
  try {
    const key = keyForUser(userId);
    const accountStorage = storage ?? localStorage;
    if (accountStorage.getItem(key) !== 'completed') accountStorage.setItem(key, 'pending');
    return true;
  } catch {
    return false;
  }
};

export const markOnboardingCompleted = (userId: number, storage?: Storage): boolean => {
  try {
    (storage ?? localStorage).setItem(keyForUser(userId), 'completed');
    return true;
  } catch {
    return false;
  }
};

export const bindNewSignupToVerifiedUser = (
  userId: number,
  isNewSignupSession: boolean,
  accountStorage?: Storage,
  handoffStorage?: Storage,
): 'not-applicable' | 'pending' | 'completed' | 'storage-unavailable' => {
  if (!isNewSignupSession && !hasNewSignupHandoff(handoffStorage)) return 'not-applicable';
  const existingState = readOnboardingState(userId, accountStorage);
  if (existingState) {
    clearNewSignupHandoff(handoffStorage);
    return existingState;
  }
  if (!markOnboardingPending(userId, accountStorage)) return 'storage-unavailable';
  clearNewSignupHandoff(handoffStorage);
  return 'pending';
};

export const isOnboardingInspectionPending = (
  userId: number | null,
  readyUserId: number | null,
  failedUserId: number | null,
): boolean => userId !== readyUserId && userId !== failedUserId;

export const isOnboardingOfflineErrorBlocking = (
  error: string | null,
  userId: number | null,
  failedUserId: number | null,
  inspectionErrorMessage: string,
): boolean => Boolean(error && !(userId !== null && failedUserId === userId && error === inspectionErrorMessage));

export const shouldAutoStartOnboarding = ({
  userId,
  isNewSignupSession,
  state,
  dashboardVisible,
  blocked,
}: {
  userId: number | null;
  isNewSignupSession: boolean;
  state: OnboardingState;
  dashboardVisible: boolean;
  blocked: boolean;
}): boolean => Boolean(
  userId && Number.isSafeInteger(userId) && userId > 0
  && dashboardVisible && !blocked
  && (state === 'pending' || (isNewSignupSession && state === null))
);
