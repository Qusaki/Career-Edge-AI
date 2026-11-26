import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { LegalConsentModal } from '../src/components/LegalConsentModal';
import { PrivacyPolicyView, TermsAgreementView } from '../src/components/LegalDocuments';
import { hasCurrentLegalAccess, LEGAL_BUNDLE_VERSION, type LegalConsentState } from '../src/utils/legalConsent';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const documents = source('../src/components/LegalDocuments.tsx');
const modal = source('../src/components/LegalConsentModal.tsx');
const entry = source('../src/components/AuthenticatedEntry.tsx');
const dashboard = source('../src/components/Dashboard.tsx');

const user = (overrides: Partial<LegalConsentState> = {}): LegalConsentState => ({
  id: 8, legal_consent_required: true, legal_consent_required_version: LEGAL_BUNDLE_VERSION,
  legal_consent_version: null, privacy_acknowledged_at: null, terms_accepted_at: null,
  ...overrides,
});

test('consent access is server-derived, account-scoped, versioned, and legacy-safe', () => {
  assert.equal(hasCurrentLegalAccess(user()), false);
  assert.equal(hasCurrentLegalAccess(user({ legal_consent_required: false })), false);
  assert.equal(hasCurrentLegalAccess(user({ legal_consent_required: false, legal_consent_version: LEGAL_BUNDLE_VERSION,
    privacy_acknowledged_at: '2026-11-27T00:00:00Z' })), false);
  assert.equal(hasCurrentLegalAccess(user({ legal_consent_required: false, legal_consent_version: LEGAL_BUNDLE_VERSION,
    privacy_acknowledged_at: '2026-11-27T00:00:00Z', terms_accepted_at: '2026-11-27T00:00:00Z' })), true);
  assert.equal(hasCurrentLegalAccess(user({ legal_consent_required: false, legal_consent_required_version: null })), true);
});

test('blocking modal starts unchecked, exposes both documents, sign-out, and disabled acceptance', () => {
  const html = renderToStaticMarkup(<LegalConsentModal apiUrl="http://example.test" userId={8} token="test-token" onAccepted={() => undefined} onSignOut={() => undefined} />);
  assert.match(html, /role="dialog" aria-modal="true"/);
  assert.match(html, /Welcome to Career Edge AI/);
  assert.match(html, /View Privacy Policy/);
  assert.match(html, /View Terms &amp; Agreement/);
  assert.match(html, /I acknowledge that I have read the Career Edge AI Privacy Policy/);
  assert.match(html, /I agree to the Career Edge AI Terms and Agreement/);
  assert.match(html, /I Agree &amp; Continue/);
  assert.match(html, /disabled=""/);
  assert.match(html, /Sign Out/);
  assert.match(modal, /!privacyChecked \|\| !termsChecked \|\| submitting/);
  assert.match(modal, /response\.ok/);
  assert.match(modal, /hasCurrentLegalAccess\(user\)/);
  assert.match(modal, /onAccepted\(user\)/);
  assert.match(modal, /if \(view !== 'consent'\) setView\('consent'\)/);
});

test('five-slide Privacy Policy uses corrected claims and is reusable', () => {
  const html = renderToStaticMarkup(<PrivacyPolicyView onBack={() => undefined} />);
  assert.match(html, /Slide 1 of 5/);
  assert.match(html, /Previous/);
  assert.match(html, /Next/);
  assert.match(html, /Close \/ Back/);
  assert.equal((documents.match(/title: '/g) || []).length, 5);
  assert.match(documents, /username where applicable/);
  assert.doesNotMatch(documents, /Student ID|account role/);
  assert.match(documents, /Passwords are cryptographically hashed using bcrypt/);
  assert.match(documents, /signed access tokens/);
  assert.match(documents, /does not currently rely on application-level session cookies/);
  assert.match(documents, /artificial intelligence to evaluate or transcribe/);
  assert.match(documents, /Pending offline records do not have a guaranteed automatic deletion date/);
  assert.match(documents, /Pending offline records may remain in browser storage/);
  assert.match(documents, /does not store raw camera video or image frames as part of the activity record/);
  assert.match(documents, /Maximillian Reth B\. Cruz/);
  assert.match(documents, /mailto:maxrethcruz@gmail\.com/);
});

test('Terms render all seven supplied sections, date, corrected contributors, and governing law', () => {
  const html = renderToStaticMarkup(<TermsAgreementView onBack={() => undefined} />);
  for (const section of [
    '1. User Accounts and Responsibilities', '2. Acceptable Use Policy', '3. Intellectual Property',
    '4. System Availability and Modifications', '5. Limitation of Liability',
    '6. Termination of Access', '7. Governing Law',
  ]) assert.ok(html.includes(section), section);
  assert.match(html, /Last Updated: November 21, 2026/);
  for (const contributor of ['Maximillian Reth B. Cruz', 'John Marcel O. Aleman',
    'Jhapniel T. Gutierrez', 'Ahkayeziah C. Arevalo']) assert.ok(html.includes(contributor));
  assert.match(html, /does not by itself transfer ownership of your personal data/);
  assert.match(html, /courts having jurisdiction in Castillejos, Zambales, subject to applicable Philippine law/);
  assert.doesNotMatch(html, /Castillejos, Zambales\]/);
});

test('entry gates Dashboard and onboarding until server acceptance, with verified offline cache only', () => {
  assert.match(entry, /GET|\/users\/me/);
  assert.match(entry, /if \(!hasCurrentLegalAccess\(user\)\)/);
  assert.ok(entry.indexOf('bindNewSignupToVerifiedUser(user.id, isNewSignupSession)')
    < entry.indexOf('if (!hasCurrentLegalAccess(user))', entry.indexOf('const inspect')));
  assert.match(entry, /kind: 'required'/);
  assert.match(entry, /if \(state\.kind === 'ready'\) return <Dashboard/);
  assert.match(entry, /legalConsentVerifiedBundleVersion === LEGAL_BUNDLE_VERSION/);
  assert.match(entry, /getVerifiedAccountForToken\(token\)/);
  assert.match(dashboard, /legalConsentVerifiedBundleVersion: hasCurrentLegalAccess\(data\)/);
  assert.match(dashboard, /legalConsentVerifiedBundleVersion: hasCurrentLegalAccess\(updatedUser\)/);
  assert.match(dashboard, /<PrivacyPolicyView onBack=\{\(\) => setActiveTab\('settings'\)\}/);
  assert.match(dashboard, /<TermsAgreementView onBack=\{\(\) => setActiveTab\('settings'\)\}/);
});
