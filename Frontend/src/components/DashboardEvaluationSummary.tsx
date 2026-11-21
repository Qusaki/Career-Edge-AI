import type { DashboardEvaluationSummary } from '../utils/dashboardEvaluationSummary';

type HistoryState = 'idle' | 'loading' | 'ready' | 'error';

interface Props {
  summary: DashboardEvaluationSummary | null;
  historyState: HistoryState;
  onStartPreTest: () => void;
  onRetry: () => void;
}

export function DashboardEvaluationSummarySection({ summary, historyState, onStartPreTest, onRetry }: Props) {
  return (
    <section aria-labelledby="current-evaluation-heading" className="mt-5 w-full min-w-0 rounded-lg border border-line bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 id="current-evaluation-heading" className="text-lg font-bold text-ink">Current Evaluation</h2>
        {summary && (
          <p className="text-xs text-muted">
            Updated {new Date(summary.completedAt).toLocaleDateString()}
          </p>
        )}
      </div>

      {summary ? (
        <>
          <p className="mt-2 break-words text-sm text-muted">Based on: {summary.families.join(' + ')}</p>
          {historyState === 'error' && (
            <p role="status" className="mt-2 text-xs text-muted">Showing the last loaded evaluation. Newer results could not be checked.</p>
          )}
          {summary.drillAuthority === 'deterministic_fallback' && (
            <p className="mt-2 text-xs text-muted">The latest Drill used limited deterministic fallback scoring; its guidance is less specific.</p>
          )}
          <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {summary.criteria.map(criterion => (
              <div key={criterion.key} className="min-w-0 rounded-lg border border-line p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-semibold text-ink">{criterion.label}</h3>
                  <p className="font-bold text-program-accent" aria-label={`${criterion.label}: ${criterion.percentage.toFixed(1)} percent`}>
                    {criterion.percentage.toFixed(1)}%
                  </p>
                </div>
                <p className="mt-1 text-xs font-semibold text-muted">{criterion.band}</p>
                <p className="mt-2 break-words text-sm leading-relaxed text-muted">{criterion.comment}</p>
                {(criterion.key === 'task_completion' || criterion.families.length !== summary.families.length) && (
                  <p className="mt-2 text-xs text-muted">Based on: {criterion.families.join(' + ')}</p>
                )}
              </div>
            ))}
          </div>
          <div className="mt-4 min-w-0 rounded-lg border border-line p-4">
            <h3 className="font-semibold text-ink">Overall Feedback</h3>
            <p className="mt-2 break-words text-sm leading-relaxed text-muted">{summary.overallFeedback}</p>
          </div>
          {summary.latestFeedback && (
            <div className="mt-3 min-w-0 rounded-lg border border-line p-4">
              <h3 className="font-semibold text-ink">Latest Evaluation Feedback</h3>
              <p className="mt-1 text-xs text-muted">From {summary.latestFeedback.family}</p>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted">{summary.latestFeedback.text}</p>
            </div>
          )}
        </>
      ) : historyState === 'error' ? (
        <div role="alert" className="mt-4 text-sm text-muted">
          <p>Your evaluation is unavailable. Check your connection and try again.</p>
          <button type="button" onClick={onRetry} className="program-accent-focus-ring program-accent-link mt-3 font-semibold">Retry</button>
        </div>
      ) : historyState !== 'ready' ? (
        <p role="status" className="mt-4 text-sm text-muted">Loading your current evaluation…</p>
      ) : (
        <div className="mt-4 text-sm text-muted">
          <h3 className="font-semibold text-ink">Get Started</h3>
          <p className="mt-2">Complete your Pre-Test to establish your communication baseline and start building your current evaluation.</p>
          <button type="button" onClick={onStartPreTest} className="program-accent-focus-ring program-accent-link mt-3 font-semibold">Start Pre-Test</button>
        </div>
      )}
    </section>
  );
}
