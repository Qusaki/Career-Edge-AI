import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

export const ONBOARDING_STEPS = [
  {
    tab: 'dashboard',
    target: 'welcome',
    title: 'Welcome to Career Edge',
    description: 'Your Dashboard is the starting point for practice and a quick view of your activity.',
  },
  {
    tab: 'dashboard',
    target: 'summary',
    title: 'Your progress at a glance',
    description: 'See completed activities and overall performance here. Detailed results are available in Progress.',
  },
  {
    tab: 'dashboard',
    target: 'navigation',
    title: 'Find your activities',
    description: 'Use the menu to move from your baseline Pre-Test to Drills, then the Post-Test when it unlocks.',
  },
  {
    tab: 'pre-test',
    target: 'pre-test',
    title: 'Start with a Pre-Test',
    description: 'Practice a personal introduction in Who Am I? and careful listening in Active Listening Pairs.',
  },
  {
    tab: 'drills',
    target: 'drills',
    title: 'Build skills with Drills',
    description: 'Work through short speaking and response exercises. Later levels unlock as you complete earlier ones.',
  },
  {
    tab: 'drills',
    target: 'post-test-navigation',
    title: 'Post-Test unlocks later',
    description: 'Complete the required Drills first. Once your progress is verified, the Post-Test measures your improvement.',
  },
  {
    tab: 'history',
    target: 'interview-history',
    title: 'Review interview practice',
    description: 'Completed University Enrollment and Thesis Defense interview sessions appear here with their results.',
  },
  {
    tab: 'interview-type',
    target: 'enrollment-interview',
    title: 'University Enrollment Interview',
    description: 'Practice a PRMSU CASTI entrance interview with Professor Maxiel in a realistic interview experience.',
  },
  {
    tab: 'interview-type',
    target: 'thesis-interview',
    title: 'Thesis Defense Interview',
    description: 'Practice defending your thesis through questions based on your thesis abstract and interview responses.',
  },
  {
    tab: 'analytics',
    target: 'progress',
    title: 'See how you improve',
    description: 'Review your activity coverage, skill breakdown, and comparisons across scored sessions.',
  },
] as const;

export type OnboardingTab = typeof ONBOARDING_STEPS[number]['tab'];

export const tabForOnboardingStep = (step: number, interviewEligible: boolean): OnboardingTab =>
  !interviewEligible && (step === 7 || step === 8) ? 'history' : ONBOARDING_STEPS[step].tab;

export const targetForOnboardingStep = (step: number, mobile: boolean, interviewEligible = true): string | null => {
  if (!interviewEligible && (step === 7 || step === 8)) return null;
  const target = ONBOARDING_STEPS[step].target;
  if (target === 'navigation') return mobile ? 'navigation-mobile' : 'navigation-desktop';
  if (target === 'post-test-navigation' && mobile) return null;
  return target;
};

type TargetRect = { top: number; left: number; width: number; height: number };
type CardPosition = { top: number; left: number };

export const positionOnboardingCard = (
  target: TargetRect | null,
  card: { width: number; height: number },
  viewport: { width: number; height: number },
): CardPosition | null => {
  if (!target) return null;
  const margin = 16;
  const spaceBelow = viewport.height - (target.top + target.height) - margin;
  const spaceAbove = target.top - margin;
  const preferredTop = spaceBelow >= card.height + margin || spaceBelow >= spaceAbove
    ? target.top + target.height + margin
    : target.top - card.height - margin;
  return {
    top: Math.max(margin, Math.min(preferredTop, viewport.height - card.height - margin)),
    left: Math.max(margin, Math.min(
      target.left + target.width / 2 - card.width / 2,
      viewport.width - card.width - margin,
    )),
  };
};

interface OnboardingGuideProps {
  onDismiss: () => void;
  onNavigate: (tab: OnboardingTab) => void;
  activeTab: OnboardingTab;
  interviewEligible: boolean;
}

export const OnboardingGuide: React.FC<OnboardingGuideProps> = ({ onDismiss, onNavigate, activeTab, interviewEligible }) => {
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const [cardPosition, setCardPosition] = useState<CardPosition | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const initialFocusScheduledRef = useRef(false);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    const overlay = overlayRef.current;
    const dialog = dialogRef.current;
    if (!overlay || !dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const inerted: Array<{ element: HTMLElement; inert: boolean; ariaHidden: string | null }> = [];
    let branch: HTMLElement = overlay;
    while (branch.parentElement && branch.parentElement !== document.body) {
      const parent = branch.parentElement;
      Array.from(parent.children).forEach((sibling) => {
        if (sibling === branch || !(sibling instanceof HTMLElement)) return;
        inerted.push({ element: sibling, inert: sibling.inert, ariaHidden: sibling.getAttribute('aria-hidden') });
        sibling.inert = true;
        sibling.setAttribute('aria-hidden', 'true');
      });
      branch = parent;
    }
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex]:not([tabindex="-1"])'));
    let initialFocusCompleted = false;
    const initialFocus = !initialFocusScheduledRef.current
      ? window.requestAnimationFrame(() => {
        dialog.focus();
        initialFocusCompleted = true;
      })
      : null;
    initialFocusScheduledRef.current = true;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onDismissRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = focusable();
      if (!controls.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      if (!dialog.contains(event.target as Node)) dialog.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      if (initialFocus !== null) {
        window.cancelAnimationFrame(initialFocus);
        if (!initialFocusCompleted) initialFocusScheduledRef.current = false;
      }
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocusIn);
      inerted.forEach(({ element, inert, ariaHidden }) => {
        element.inert = inert;
        if (ariaHidden === null) element.removeAttribute('aria-hidden');
        else element.setAttribute('aria-hidden', ariaHidden);
      });
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [activeTab]);

  useEffect(() => {
    let frame = 0;
    let observer: MutationObserver | null = null;
    setTargetRect(null);
    setCardPosition(null);
    const findTarget = (): HTMLElement | null => {
      const mobile = window.matchMedia('(max-width: 1023px)').matches;
      const name = targetForOnboardingStep(stepIndex, mobile, interviewEligible);
      if (!name || activeTab !== tabForOnboardingStep(stepIndex, interviewEligible)) return null;
      const target = document.querySelector<HTMLElement>(`[data-onboarding="${name}"]`);
      return target && target.getClientRects().length > 0 ? target : null;
    };
    const updatePosition = () => {
      const target = findTarget();
      if (target) observer?.disconnect();
      if (target) {
        const rect = target.getBoundingClientRect();
        if (rect.top < 16 || rect.bottom > window.innerHeight - 16) {
          target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
        }
      }
      const rect = target?.getBoundingClientRect();
      const visibleRect = rect && rect.width > 0 && rect.height > 0
        ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
        : null;
      setTargetRect(visibleRect);
      const card = dialogRef.current?.getBoundingClientRect();
      setCardPosition(positionOnboardingCard(
        visibleRect,
        { width: card?.width ?? 360, height: card?.height ?? 270 },
        { width: window.innerWidth, height: window.innerHeight },
      ));
    };
    const schedulePosition = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updatePosition);
    };
    schedulePosition();
    if (targetForOnboardingStep(stepIndex, window.matchMedia('(max-width: 1023px)').matches, interviewEligible)) {
      observer = new MutationObserver(schedulePosition);
      observer.observe(document.body, { childList: true, subtree: true });
    }
    window.addEventListener('resize', schedulePosition);
    document.addEventListener('scroll', schedulePosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', schedulePosition);
      document.removeEventListener('scroll', schedulePosition, true);
    };
  }, [stepIndex, activeTab, interviewEligible]);

  useEffect(() => {
    if (stepIndex > 0) titleRef.current?.focus();
  }, [stepIndex]);

  const step = ONBOARDING_STEPS[stepIndex];
  const lastStep = stepIndex === ONBOARDING_STEPS.length - 1;
  const changeStep = (nextStep: number) => {
    setTargetRect(null);
    setCardPosition(null);
    onNavigate(tabForOnboardingStep(nextStep, interviewEligible));
    setStepIndex(nextStep);
  };

  return (
    <div ref={overlayRef} className={`fixed inset-0 z-[10000] ${targetRect ? '' : 'bg-slate-950/75'}`}>
      {targetRect && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed rounded-xl border-2 border-[var(--program-accent)]"
          style={{
            top: targetRect.top - 6,
            left: targetRect.left - 6,
            width: targetRect.width + 12,
            height: targetRect.height + 12,
            boxShadow: '0 0 0 100vmax rgba(2, 6, 23, 0.74)',
          }}
        />
      )}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        aria-describedby="onboarding-description"
        tabIndex={-1}
        className="fixed z-10 max-h-[calc(100dvh-2rem)] w-[min(22.5rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-line bg-card p-5 text-ink shadow-2xl outline-none sm:p-6"
        style={cardPosition
          ? { top: cardPosition.top, left: cardPosition.left }
          : { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-program-accent" aria-live="polite">
              Step {stepIndex + 1} of {ONBOARDING_STEPS.length}
            </p>
            <h2 ref={titleRef} id="onboarding-title" tabIndex={-1} className="mt-2 text-xl font-bold text-ink outline-none">
              {step.title}
            </h2>
          </div>
          <button type="button" aria-label="Close guide" onClick={onDismiss} className="program-accent-focus-ring flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-active hover:text-ink">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <p id="onboarding-description" className="mt-3 text-sm leading-relaxed text-muted">{step.description}</p>
        {!interviewEligible && (stepIndex === 7 || stepIndex === 8) && (
          <p className="mt-2 text-sm leading-relaxed text-muted">Interview choices are available only to CCIT, CTE, and CBAPA students. Your account cannot open them yet.</p>
        )}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
          <button type="button" onClick={onDismiss} className="program-accent-focus-ring min-h-11 rounded-lg px-3 py-2 text-sm font-semibold text-muted hover:bg-active hover:text-ink">Skip</button>
          <div className="flex items-center gap-2">
            {stepIndex > 0 && (
              <button type="button" onClick={() => changeStep(stepIndex - 1)} className="program-accent-focus-ring min-h-11 rounded-lg border border-line px-3 py-2 text-sm font-semibold text-ink hover:bg-active">Back</button>
            )}
            <button
              type="button"
              onClick={lastStep ? onDismiss : () => changeStep(stepIndex + 1)}
              className="program-accent-button min-h-11 rounded-lg px-4 py-2 text-sm font-semibold"
            >
              {lastStep ? 'Got it' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
