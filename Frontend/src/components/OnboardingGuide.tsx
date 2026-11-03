import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

export const ONBOARDING_STEPS = [
  {
    target: 'welcome',
    title: 'Welcome to Career Edge',
    description: 'This is your home dashboard. You can see your progress, recent sessions, and access your Career Edge activities from here.',
  },
  {
    target: 'summary',
    title: 'Track your progress',
    description: 'These cards give you a quick overview of your completed activities, average performance, and overall progress.',
  },
  {
    target: 'recent-sessions',
    title: 'Review recent sessions',
    description: 'Your completed interview and practice sessions will appear here as you use Career Edge.',
  },
  {
    target: 'navigation',
    title: 'Explore Career Edge',
    description: 'Use the navigation menu to open Pre-Test, Drills, Post-Test, Interview Practice, Progress, and your account options. Some activities may unlock as you progress.',
  },
] as const;

export const targetForOnboardingStep = (step: number, mobile: boolean): string =>
  ONBOARDING_STEPS[step].target === 'navigation'
    ? mobile ? 'navigation-mobile' : 'navigation-desktop'
    : ONBOARDING_STEPS[step].target;

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
}

export const OnboardingGuide: React.FC<OnboardingGuideProps> = ({ onDismiss }) => {
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const [cardPosition, setCardPosition] = useState<CardPosition | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
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
    const initialFocus = window.requestAnimationFrame(() => dialog.focus());
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
      window.cancelAnimationFrame(initialFocus);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocusIn);
      inerted.forEach(({ element, inert, ariaHidden }) => {
        element.inert = inert;
        if (ariaHidden === null) element.removeAttribute('aria-hidden');
        else element.setAttribute('aria-hidden', ariaHidden);
      });
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    let frame = 0;
    const findTarget = (): HTMLElement | null => {
      const mobile = window.matchMedia('(max-width: 1023px)').matches;
      const name = targetForOnboardingStep(stepIndex, mobile);
      const target = document.querySelector<HTMLElement>(`[data-onboarding="${name}"]`);
      return target && target.getClientRects().length > 0 ? target : null;
    };
    const updatePosition = () => {
      const target = findTarget();
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
    const target = findTarget();
    if (target) {
      const rect = target.getBoundingClientRect();
      if (rect.top < 16 || rect.bottom > window.innerHeight - 16) {
        target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
      }
    }
    schedulePosition();
    window.addEventListener('resize', schedulePosition);
    document.addEventListener('scroll', schedulePosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedulePosition);
      document.removeEventListener('scroll', schedulePosition, true);
    };
  }, [stepIndex]);

  useEffect(() => {
    if (stepIndex > 0) titleRef.current?.focus();
  }, [stepIndex]);

  const step = ONBOARDING_STEPS[stepIndex];
  const lastStep = stepIndex === ONBOARDING_STEPS.length - 1;

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
        <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
          <button type="button" onClick={onDismiss} className="program-accent-focus-ring min-h-11 rounded-lg px-3 py-2 text-sm font-semibold text-muted hover:bg-active hover:text-ink">Skip</button>
          <div className="flex items-center gap-2">
            {stepIndex > 0 && (
              <button type="button" onClick={() => setStepIndex(index => index - 1)} className="program-accent-focus-ring min-h-11 rounded-lg border border-line px-3 py-2 text-sm font-semibold text-ink hover:bg-active">Back</button>
            )}
            <button
              type="button"
              onClick={lastStep ? onDismiss : () => setStepIndex(index => index + 1)}
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
