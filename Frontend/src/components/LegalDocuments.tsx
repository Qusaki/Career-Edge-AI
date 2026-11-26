import { useState } from 'react';
import { LEGAL_BUNDLE_VERSION } from '../utils/legalConsent';

const navigationButton = 'program-accent-focus-ring min-h-11 rounded-lg border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-active disabled:cursor-not-allowed disabled:opacity-50';

const privacySlides = [
  {
    title: 'Privacy and Data Protection',
    content: <div className="space-y-4">
      <p>Career Edge AI values your privacy and is committed to protecting your personal data in accordance with Republic Act No. 10173, otherwise known as the Data Privacy Act of 2012 (DPA), its Implementing Rules and Regulations (IRR), and applicable issuances of the National Privacy Commission (NPC).</p>
      <p>This Privacy Policy explains what personal data Career Edge AI processes, why it is processed, how it is protected, and the choices and rights available to you.</p>
      <p>Before continuing to use Career Edge AI as a newly registered user, you will be asked to acknowledge that you have read this Privacy Policy and to separately agree to the Career Edge AI Terms and Agreement.</p>
    </div>,
  },
  {
    title: '1. Information We Process',
    content: <div className="space-y-4">
      <p><strong>Account and Identity Data:</strong> Your full name, email address, username where applicable, and other profile information maintained by the system. Passwords are not stored in plain text. Career Edge AI stores a cryptographic password hash used to verify your password.</p>
      <p><strong>System and Progress Data:</strong> Activity records, completed modules or tasks, progress metrics, scores, evaluation feedback, timestamps, submitted answers, messages, spoken-response transcripts, and other inputs you provide while using Career Edge AI.</p>
      <p><strong>Authentication Data:</strong> Career Edge AI uses signed access tokens to authenticate your account and maintain your signed-in session. These tokens may be stored in your browser.</p>
      <p><strong>Speech and Audio Data:</strong> Spoken responses may be converted into text for assessment and evaluation. When offline audio fallback is used, an audio recording may be stored temporarily in account-scoped browser storage until it can be processed or synchronized. Audio submitted to the server transcription endpoint is processed for transcription and is not intentionally retained by that endpoint after processing.</p>
      <p>Pending offline records may remain in browser storage while awaiting processing or synchronization and do not have a guaranteed automatic deletion period.</p>
      <p><strong>Visual Engagement Data:</strong> When camera-assisted activities are enabled, Career Edge AI may calculate and store Visual Engagement scores and sample counts. The application does not store raw camera video or image frames as part of the activity record.</p>
      <p>Career Edge AI does not currently rely on application-level session cookies for authentication and does not intentionally maintain dedicated application database fields for browser type, device information, or IP address. Hosting or infrastructure providers may maintain operational logs according to their own service and security practices.</p>
    </div>,
  },
  {
    title: '2. Purpose and Method of Processing',
    content: <div className="space-y-4">
      <p>Career Edge AI processes information for legitimate educational, operational, and security purposes, including:</p>
      <ul className="list-disc space-y-1 pl-6">
        <li>Authenticating your identity and securing access to your account.</li>
        <li>Delivering Pre-Test, Drill, Post-Test, interview, progress, and related learning features.</li>
        <li>Tracking, saving, and displaying your progress and historical performance.</li>
        <li>Evaluating submitted responses and providing scores, feedback, recommendations, and other learning guidance.</li>
        <li>Transcribing spoken responses when transcription is required.</li>
        <li>Synchronizing eligible offline activity data after connectivity is restored.</li>
        <li>Improving system functionality, troubleshooting technical issues, and maintaining platform reliability and security.</li>
        <li>Communicating essential account, security, or administrative information where applicable.</li>
      </ul>
      <p>Some Career Edge AI features use artificial intelligence to evaluate or transcribe submitted responses. Depending on the configured system environment, relevant text, transcripts, or audio may be processed by a configured AI service provider or by a locally hosted AI service.</p>
      <p>Career Edge AI may also rely on service providers for functions such as system hosting, AI processing, and email delivery where those services are enabled. Only information necessary to provide the applicable service should be processed for those purposes.</p>
    </div>,
  },
  {
    title: '3. Data Security and Confidentiality',
    content: <div className="space-y-4">
      <p>Career Edge AI implements reasonable organizational and technical measures intended to protect personal data against unauthorized access, alteration, disclosure, loss, or destruction.</p>
      <p><strong>Password Protection:</strong> Passwords are cryptographically hashed using bcrypt. Plain-text passwords are not stored in the application database.</p>
      <p><strong>Authentication Security:</strong> Career Edge AI uses signed authentication tokens with expiration and access controls to protect authenticated sessions.</p>
      <p><strong>Secure Transmission:</strong> Career Edge AI is designed to use HTTPS/TLS for production web communication and secure WebSocket connections when deployed through HTTPS.</p>
      <p><strong>Access Control and Confidentiality:</strong> Access to backend systems and databases is limited to authorized personnel and system processes that require such access.</p>
      <p>Career Edge AI does not sell, trade, or rent personal or progress data. However, information may be processed by service providers used to operate features such as hosting, AI-assisted evaluation or transcription, and system communications.</p>
    </div>,
  },
  {
    title: '4. Data Retention, Your Rights, and Contact Information',
    content: <div className="space-y-4">
      <h3 className="font-bold text-ink">Data Retention and Disposal</h3>
      <p>Career Edge AI retains account, activity, and progress information only for as long as reasonably necessary for educational, operational, security, or applicable legal purposes.</p>
      <p>The current platform does not guarantee a single automatic server-side deletion period for all account and assessment records. Authorized administrators may manage records as required by the system's operational and legal obligations.</p>
      <p>Certain synchronized offline records stored in the browser may be automatically cleared according to the application's local storage-cleanup rules.</p>
      <p>Pending offline records do not have a guaranteed automatic deletion date and may remain in browser storage until successfully processed, synchronized, removed by applicable application cleanup behavior, or cleared through browser/site data management.</p>
      <p>If an account is administratively deleted or Career Edge AI reaches the end of its operational lifecycle, associated data should be handled or disposed of in accordance with applicable data-protection requirements.</p>
      <h3 className="font-bold text-ink">5. Your Data Privacy Rights</h3>
      <p>Subject to applicable law, you may exercise rights provided under the Data Privacy Act of 2012, including the rights to be informed, access your personal data, object to certain processing, request correction of inaccurate data, request erasure or blocking where applicable, and exercise other rights recognized by the National Privacy Commission.</p>
      <h3 className="font-bold text-ink">6. Contact Information</h3>
      <p>For inquiries, requests concerning your data privacy rights, or security concerns, please contact the Career Edge AI System Administrator:</p>
      <p><strong>Name:</strong> Maximillian Reth B. Cruz<br /><strong>Email:</strong> <a className="program-accent-focus-ring underline" href="mailto:maxrethcruz@gmail.com">maxrethcruz@gmail.com</a></p>
    </div>,
  },
] as const;

export function PrivacyPolicyView({ onBack }: { onBack: () => void }) {
  const [slide, setSlide] = useState(0);
  return <article className="min-w-0 rounded-xl border border-line bg-card p-4 text-ink sm:p-6" aria-labelledby="privacy-policy-title">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h2 id="privacy-policy-title" className="text-xl font-bold">Career Edge AI Privacy Policy</h2>
      <button type="button" onClick={onBack} className={navigationButton}>Close / Back</button>
    </div>
    <p className="mb-3 text-sm text-muted">Legal Bundle Version: {LEGAL_BUNDLE_VERSION}</p>
    <p className="mb-3 text-sm font-semibold" aria-live="polite">Slide {slide + 1} of {privacySlides.length}</p>
    <div className="max-h-[60vh] min-w-0 overflow-y-auto break-words text-sm leading-relaxed text-ink sm:text-base" key={slide}>
      <h3 className="mb-4 text-lg font-bold">{privacySlides[slide].title}</h3>
      {privacySlides[slide].content}
    </div>
    <div className="mt-5 flex flex-wrap justify-between gap-3 border-t border-line pt-4">
      <button type="button" disabled={slide === 0} onClick={() => setSlide(current => current - 1)} className={navigationButton}>Previous</button>
      <button type="button" disabled={slide === privacySlides.length - 1} onClick={() => setSlide(current => current + 1)} className={navigationButton}>Next</button>
    </div>
  </article>;
}

export function TermsAgreementView({ onBack }: { onBack: () => void }) {
  return <article className="min-w-0 rounded-xl border border-line bg-card p-4 text-ink sm:p-6" aria-labelledby="terms-title">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h2 id="terms-title" className="text-xl font-bold">Career Edge AI Terms and Agreement</h2>
      <button type="button" onClick={onBack} className={navigationButton}>Close / Back</button>
    </div>
    <p className="mb-4 text-sm text-muted">Last Updated: November 21, 2026</p>
    <div className="max-h-[65vh] min-w-0 space-y-5 overflow-y-auto break-words text-sm leading-relaxed sm:text-base">
      <p>Welcome to Career Edge AI. By registering for and using this web-based platform, you agree to be bound by these Terms and Agreement. If you do not agree with these terms, you should not continue using the protected features of the system.</p>
      <section><h3 className="mb-2 text-lg font-bold">1. User Accounts and Responsibilities</h3>
        <h4 className="font-semibold">Accurate Information</h4><p>You agree to provide accurate, current, and complete information during registration and to keep your profile information updated where applicable.</p>
        <h4 className="mt-3 font-semibold">Account Security</h4><p>You are responsible for maintaining the confidentiality of your login credentials. You agree not to share your password with others and to notify the system administrators if you suspect unauthorized use of your account.</p>
        <h4 className="mt-3 font-semibold">Single User Policy</h4><p>Your account and recorded progress are personal to you. Allowing another person to complete activities or generate progress data on your behalf is prohibited.</p>
      </section>
      <section><h3 className="mb-2 text-lg font-bold">2. Acceptable Use Policy</h3><p>When using Career Edge AI, you agree not to:</p>
        <ul className="list-disc space-y-1 pl-6"><li>Attempt to bypass, disable, or interfere with the system's security features, authentication mechanisms, or access controls.</li><li>Use unauthorized automated scripts, bots, or scraping tools to extract protected data or manipulate progress records.</li><li>Upload or introduce malicious code, viruses, or harmful content that may disrupt the platform or affect other users.</li><li>Attempt to access accounts, progress records, administrative functionality, or other protected information that you are not authorized to access.</li></ul>
      </section>
      <section><h3 className="mb-2 text-lg font-bold">3. Intellectual Property</h3><p>The Career Edge AI software architecture, user-interface designs, source code, logos, and original project materials developed for the system are the intellectual property of:</p>
        <ol className="list-decimal pl-6"><li>Maximillian Reth B. Cruz</li><li>John Marcel O. Aleman</li><li>Jhapniel T. Gutierrez</li><li>Ahkayeziah C. Arevalo</li></ol>
        <p className="mt-3">These materials are protected by applicable copyright and intellectual-property laws.</p>
        <p className="mt-3">You are granted a limited, non-transferable right to use Career Edge AI solely for its intended educational and system purposes.</p>
        <p className="mt-3">This provision does not by itself transfer ownership of your personal data or content you submit to Career Edge AI to the developers.</p>
      </section>
      <section><h3 className="mb-2 text-lg font-bold">4. System Availability and Modifications</h3><p>We strive to keep Career Edge AI accessible and reliable; however, uninterrupted availability is not guaranteed.</p><p className="mt-3">The development or administrative team may perform scheduled maintenance, update system features, correct technical issues, or temporarily suspend access when necessary for maintenance, security, or system improvements.</p></section>
      <section><h3 className="mb-2 text-lg font-bold">5. Limitation of Liability</h3><p>While Career Edge AI uses security measures intended to safeguard user data and system access, no online system can guarantee complete protection from every technical failure or cybersecurity threat.</p><p className="mt-3">To the fullest extent permitted by applicable law, the developers shall not be liable for indirect, incidental, or consequential damages resulting from circumstances beyond reasonable system control, including unauthorized access resulting from user negligence, such as voluntarily sharing passwords or using compromised devices, or from force majeure events.</p></section>
      <section><h3 className="mb-2 text-lg font-bold">6. Termination of Access</h3><p>Career Edge AI administrators may suspend or terminate access to the system when a user violates these Terms and Agreement or engages in conduct that threatens system security, integrity, availability, or the rights of other users.</p></section>
      <section><h3 className="mb-2 text-lg font-bold">7. Governing Law</h3><p>These Terms and Agreement shall be governed by and construed in accordance with the laws of the Republic of the Philippines.</p><p className="mt-3">Any dispute arising from the use of Career Edge AI shall be resolved in the appropriate courts having jurisdiction in Castillejos, Zambales, subject to applicable Philippine law.</p></section>
    </div>
  </article>;
}
