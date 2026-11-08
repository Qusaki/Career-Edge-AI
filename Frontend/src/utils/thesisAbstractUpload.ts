export const THESIS_ABSTRACT_MAX_BYTES = 10 * 1024 * 1024;
export const THESIS_ABSTRACT_ACCEPT = '.pdf,.docx,.txt';

export class ThesisAbstractFileError extends Error {}

export const validateThesisAbstractFile = (file: Pick<File, 'name' | 'size'>): string | null => {
  if (!/\.(pdf|docx|txt)$/i.test(file.name)) return 'Please upload a PDF, DOCX, or TXT file.';
  if (file.size <= 0) return 'The selected abstract is empty.';
  if (file.size > THESIS_ABSTRACT_MAX_BYTES) return 'The thesis abstract must be 10 MB or smaller.';
  return null;
};

export const thesisAbstractUploadError = (status: number): string => {
  if (status === 400 || status === 422) return 'The abstract could not be accepted. Please upload a readable PDF, DOCX, or TXT file.';
  if (status === 401 || status === 403) return 'Your session could not be authorized. Please sign in again.';
  if (status === 404) return 'This thesis session was not found. Please restart the activity.';
  if (status === 409) return 'This thesis session is no longer active. The abstract was not changed.';
  if (status === 413) return 'The thesis abstract must be 10 MB or smaller.';
  return 'The abstract could not be saved. Please try again.';
};
