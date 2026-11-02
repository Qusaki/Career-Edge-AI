export const MIN_PASSWORD_CHARACTERS = 15;
export const MAX_PASSWORD_UTF8_BYTES = 72;

export const getNewPasswordError = (password: string): string | null => {
  if (!password.trim()) return 'Password cannot contain only spaces.';
  if (Array.from(password).length < MIN_PASSWORD_CHARACTERS) return 'Password must be at least 15 characters.';
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_UTF8_BYTES) {
    return 'Password is too long. Use at most 72 UTF-8 bytes.';
  }
  return null;
};
