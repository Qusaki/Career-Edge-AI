const VERIFIED_ACCOUNT_BINDING_KEY = 'career-edge-verified-account-binding-v1';

interface VerifiedAccountBinding {
  userId: number;
  tokenFingerprint: string;
}

const requireUserId = (userId: number): number => {
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new Error('A verified backend user ID is required.');
  }
  return userId;
};

const fingerprintToken = async (token: string): Promise<string | null> => {
  if (!token || !globalThis.crypto?.subtle) return null;
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

export const rememberVerifiedAccount = async (
  token: string,
  userId: number,
): Promise<boolean> => {
  const tokenFingerprint = await fingerprintToken(token);
  if (!tokenFingerprint) return false;

  const binding: VerifiedAccountBinding = {
    userId: requireUserId(userId),
    tokenFingerprint,
  };
  localStorage.setItem(VERIFIED_ACCOUNT_BINDING_KEY, JSON.stringify(binding));
  return true;
};

export const getVerifiedAccountForToken = async (token: string): Promise<number | null> => {
  const tokenFingerprint = await fingerprintToken(token);
  if (!tokenFingerprint) return null;

  try {
    const serialized = localStorage.getItem(VERIFIED_ACCOUNT_BINDING_KEY);
    if (!serialized) return null;
    const binding = JSON.parse(serialized) as Partial<VerifiedAccountBinding>;
    if (
      !Number.isSafeInteger(binding.userId)
      || Number(binding.userId) <= 0
      || binding.tokenFingerprint !== tokenFingerprint
    ) {
      return null;
    }
    return Number(binding.userId);
  } catch {
    return null;
  }
};

export const forgetVerifiedAccount = (): void => {
  localStorage.removeItem(VERIFIED_ACCOUNT_BINDING_KEY);
};
