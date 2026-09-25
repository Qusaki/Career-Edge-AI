import { normalizeApiError } from './httpError';

export const PRE_TEST_SESSION_RECOVERY_MESSAGE =
  'This Pre-Test session could not be restored. Please restart the activity.';

export const normalizePreTestApiError = (body: unknown, fallback: string): string => {
  const message = normalizeApiError(body, fallback);
  return /input should be a valid integer|unable to parse string as an integer/i.test(message)
    ? PRE_TEST_SESSION_RECOVERY_MESSAGE
    : message;
};
