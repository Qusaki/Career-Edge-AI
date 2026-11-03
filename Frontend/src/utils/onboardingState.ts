export type OnboardingState = 'pending' | 'completed' | null;

const ONBOARDING_KEY_PREFIX = 'career-edge:onboarding:v1:';

const keyForUser = (userId: number): string => {
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new Error('A verified user ID is required for onboarding.');
  }
  return `${ONBOARDING_KEY_PREFIX}${userId}`;
};

export const readOnboardingState = (userId: number, storage: Storage = localStorage): OnboardingState => {
  try {
    const value = storage.getItem(keyForUser(userId));
    return value === 'pending' || value === 'completed' ? value : null;
  } catch {
    return null;
  }
};

export const markOnboardingPending = (userId: number, storage: Storage = localStorage): boolean => {
  try {
    const key = keyForUser(userId);
    if (storage.getItem(key) !== 'completed') storage.setItem(key, 'pending');
    return true;
  } catch {
    return false;
  }
};

export const markOnboardingCompleted = (userId: number, storage: Storage = localStorage): boolean => {
  try {
    storage.setItem(keyForUser(userId), 'completed');
    return true;
  } catch {
    return false;
  }
};

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
