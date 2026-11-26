export const LEGAL_BUNDLE_VERSION = '2026-11-21';

export interface LegalConsentState {
  id: number;
  legal_consent_required: boolean;
  legal_consent_required_version: string | null;
  legal_consent_version: string | null;
  privacy_acknowledged_at: string | null;
  terms_accepted_at: string | null;
}

export const hasCurrentLegalAccess = (user: LegalConsentState): boolean => {
  if (user.legal_consent_required_version === null) return !user.legal_consent_required;
  return !user.legal_consent_required
    && user.legal_consent_version === user.legal_consent_required_version
    && Boolean(user.privacy_acknowledged_at && user.terms_accepted_at);
};
