export const MIN_PASSWORD_CHARACTERS = 8;
export const MAX_PASSWORD_UTF8_BYTES = 72;
export const NEW_PASSWORD_GUIDANCE = 'Use at least 8 characters with uppercase and lowercase letters, numbers, and special symbols.';

export const getNewPasswordError = (password: string): string | null => {
  if (!password.trim()) return 'Password cannot contain only spaces.';
  if (Array.from(password).length < MIN_PASSWORD_CHARACTERS) return 'Password must be at least 8 characters.';
  try {
    encodeURIComponent(password);
  } catch {
    return 'Password contains an invalid character.';
  }
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_UTF8_BYTES) {
    return 'Password is too long. Use at most 72 UTF-8 bytes.';
  }
  if (!/\p{Lu}/u.test(password)) return 'Password must include at least one uppercase letter.';
  if (!/\p{Ll}/u.test(password)) return 'Password must include at least one lowercase letter.';
  if (!/\p{Nd}/u.test(password)) return 'Password must include at least one number.';
  if (!/[\p{P}\p{S}]/u.test(password)) return 'Password must include at least one special character.';
  return null;
};
