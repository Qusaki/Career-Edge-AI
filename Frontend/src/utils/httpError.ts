type UnknownRecord = Record<string, unknown>;

const isUnknownRecord = (value: unknown): value is UnknownRecord => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const readNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const message = value.trim();
  return message || null;
};

const readValidationMessages = (value: unknown[]): string | null => {
  const messages = value.flatMap(entry => {
    const directMessage = readNonEmptyString(entry);
    if (directMessage) return [directMessage];
    if (!isUnknownRecord(entry)) return [];
    const validationMessage = readNonEmptyString(entry.msg) || readNonEmptyString(entry.message);
    return validationMessage ? [validationMessage] : [];
  });
  return messages.length > 0 ? [...new Set(messages)].join('; ') : null;
};

const readDetailMessage = (detail: unknown): string | null => {
  const directMessage = readNonEmptyString(detail);
  if (directMessage) return directMessage;
  if (detail instanceof Error) return readNonEmptyString(detail.message);
  if (Array.isArray(detail)) return readValidationMessages(detail);
  if (!isUnknownRecord(detail)) return null;
  return readNonEmptyString(detail.message) || readNonEmptyString(detail.msg);
};

export const normalizeApiError = (body: unknown, fallback: string): string => {
  const safeFallback = readNonEmptyString(fallback) || 'The request could not be completed.';
  const directMessage = readNonEmptyString(body);
  if (directMessage) return directMessage;
  if (body instanceof Error) return readNonEmptyString(body.message) || safeFallback;
  if (!isUnknownRecord(body)) return safeFallback;

  const detailMessage = readDetailMessage(body.detail);
  if (detailMessage) return detailMessage;
  return readNonEmptyString(body.message) || safeFallback;
};
