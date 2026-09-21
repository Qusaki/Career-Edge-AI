export type PostTestAccess = {
  post_test_unlocked: boolean;
  completed_drill_count: number;
  required_drill_count: number;
};

export type PostTestVerificationState =
  | { status: 'unknown' }
  | { status: 'verified_locked'; userId: number; progress: PostTestAccess }
  | { status: 'verified_unlocked'; userId: number; progress: PostTestAccess };

export const UNKNOWN_POST_TEST_VERIFICATION: PostTestVerificationState = { status: 'unknown' };

export const verifyPostTestAccess = (userId: number, progress: PostTestAccess): PostTestVerificationState => ({
  status: progress.post_test_unlocked ? 'verified_unlocked' : 'verified_locked',
  userId,
  progress,
});

export const retainPostTestVerificationForUser = (
  current: PostTestVerificationState,
  userId: number,
): PostTestVerificationState =>
  current.status !== 'unknown' && current.userId === userId ? current : UNKNOWN_POST_TEST_VERIFICATION;

export const postTestAccessForUser = (
  verification: PostTestVerificationState,
  userId: number | null,
): PostTestAccess | null =>
  verification.status !== 'unknown' && verification.userId === userId ? verification.progress : null;

export const readPostTestAccess = (value: unknown): PostTestAccess | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  if (!('post_test_unlocked' in value) || typeof value.post_test_unlocked !== 'boolean') return null;
  if (!('completed_drill_count' in value) || typeof value.completed_drill_count !== 'number' || !Number.isSafeInteger(value.completed_drill_count)) return null;
  if (!('required_drill_count' in value) || typeof value.required_drill_count !== 'number' || !Number.isSafeInteger(value.required_drill_count)) return null;
  if (value.completed_drill_count < 0 || value.required_drill_count <= 0) return null;
  return {
    post_test_unlocked: value.post_test_unlocked,
    completed_drill_count: value.completed_drill_count,
    required_drill_count: value.required_drill_count,
  };
};

export const isPostTestUnlocked = (progress: PostTestAccess | null): boolean =>
  progress?.post_test_unlocked === true;

export const requestPostTestNavigation = (
  progress: PostTestAccess | null,
  navigate: () => void,
  showLockedGuidance: () => void,
): void => {
  if (!isPostTestUnlocked(progress)) {
    showLockedGuidance();
    return;
  }
  navigate();
};
