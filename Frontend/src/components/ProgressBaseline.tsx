import { useEffect, useMemo, useState } from 'react';
import { derivePreTestBaseline, type BaselineSourceKind } from '../utils/preTestBaseline';

const sourceName = (kind: BaselineSourceKind): string => kind === 'who-am-i' ? 'Who Am I?' : 'Active Listening';
const formatDate = (value: string | null): string => value ? new Date(value).toLocaleString() : 'Completion date unavailable';

export function ProgressBaseline({
  records, historyState, historyOwnerId, userId,
}: {
  records: readonly Record<string, unknown>[];
  historyState: 'idle' | 'loading' | 'ready' | 'error';
  historyOwnerId: number | null;
  userId: number | null;
}) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { setExpanded(false); }, [userId]);
  const ownsHistory = userId !== null && historyOwnerId === userId;
  const baseline = useMemo(() => derivePreTestBaseline(ownsHistory ? records : []), [ownsHistory, records]);
  const coverage = baseline?.sources.map(source => sourceName(source.kind)).join(' + ');

  return (
    <section aria-labelledby="progress-baseline-heading" className="min-w-0 rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-xl backdrop-blur-sm md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="progress-baseline-heading" className="text-xl font-bold italic tracking-tight text-slate-100">Baseline</h3>
          <p className="mt-1 text-sm text-slate-400">Your initial server-recorded Pre-Test evaluation.</p>
        </div>
        {baseline && <span className="program-accent-surface rounded-full px-3 py-1 text-xs font-bold">
          {baseline.coverage === 'partial' ? 'Partial Baseline' : 'Initial Pre-Test'}
        </span>}
      </div>

      {!ownsHistory ? (
        <p className="mt-5 text-sm text-slate-400" role={historyState === 'error' ? 'alert' : 'status'}>
          {historyState === 'error' ? 'Pre-Test history could not be loaded. Check your connection and try again.' : 'Loading Pre-Test history...'}
        </p>
      ) : !baseline ? (
        <p className="mt-5 text-sm text-slate-400" role={historyState === 'error' ? 'alert' : 'status'}>
          {historyState === 'error' ? 'Pre-Test history could not be refreshed. Check your connection and try again.'
            : historyState === 'loading' ? 'Loading Pre-Test history...' : 'Complete your Pre-Test to establish your baseline.'}
        </p>
      ) : (
        <div className="mt-5 min-w-0 space-y-5">
          <div className="text-sm text-slate-300">
            <p><span className="font-semibold text-slate-100">Based on:</span> {coverage}{baseline.coverage === 'partial' ? ' only' : ''}</p>
            <p className="mt-1 text-xs text-slate-400">
              {baseline.coverage === 'partial' ? 'Partial Baseline' : 'Baseline established'} · {formatDate(baseline.establishedAt)}
            </p>
          </div>

          {baseline.criteria.length > 0 ? (
            <div className="space-y-3" aria-label="Initial Pre-Test communication criteria">
              {baseline.criteria.map(criterion => (
                <div key={criterion.key} className="min-w-0 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <h4 className="text-sm font-bold text-slate-100">{criterion.label}</h4>
                      <p className="mt-0.5 text-xs text-slate-400">{criterion.sources.map(sourceName).join(' + ')}</p>
                    </div>
                    <strong className="text-sm text-slate-100">{criterion.percentage.toFixed(1)}%</strong>
                  </div>
                  <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-800" aria-hidden="true">
                    <div className="program-accent-fill h-full rounded-full" style={{ width: `${criterion.percentage}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-slate-400">Scores for these initial sessions are unavailable.</p>}

          {baseline.visualEngagement !== null && (
            <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
              <p className="text-sm font-bold text-slate-100">Initial Pre-Test Visual Engagement</p>
              <p className="mt-1 text-sm text-slate-300">{baseline.visualEngagement.toFixed(1)}% · Camera samples from the selected initial Pre-Test sessions only</p>
            </div>
          )}

          <button type="button" aria-expanded={expanded} aria-controls="progress-baseline-feedback"
            onClick={() => setExpanded(current => !current)}
            className="program-accent-focus-ring min-h-11 rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-slate-800">
            View Strengths &amp; Improvements
          </button>

          <div id="progress-baseline-feedback" hidden={!expanded} className="min-w-0 space-y-5 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
            <div>
              <h4 className="font-bold text-slate-100">Strengths</h4>
              {baseline.strengths.length > 0 ? (
                <ul className="mt-2 space-y-2 text-sm text-slate-300">
                  {baseline.strengths.map(item => <li key={item.criterion.key} className="break-words">
                    <strong className="text-slate-100">{item.criterion.label} · {item.criterion.percentage.toFixed(1)}%</strong> — {item.note}
                  </li>)}
                </ul>
              ) : <p className="mt-2 text-sm text-slate-400">No supported criterion scores are available yet.</p>}
            </div>
            <div>
              <h4 className="font-bold text-slate-100">Areas for Improvement</h4>
              {baseline.priorities.length > 0 ? (
                <ul className="mt-2 space-y-2 text-sm text-slate-300">
                  {baseline.priorities.map(item => <li key={item.criterion.key} className="break-words">
                    <strong className="text-slate-100">{item.criterion.label} · {item.criterion.percentage.toFixed(1)}%</strong> — {item.note}
                  </li>)}
                </ul>
              ) : <p className="mt-2 text-sm text-slate-400">No separate area to prioritize can be identified from the available criteria.</p>}
            </div>
            {baseline.additionalWhoAmI && (baseline.additionalWhoAmI.completeness !== null || baseline.additionalWhoAmI.correctness !== null) && (
              <div>
                <h4 className="font-bold text-slate-100">Who Am I? additional indicators</h4>
                <div className="mt-2 flex flex-wrap gap-2 text-sm text-slate-300">
                  {baseline.additionalWhoAmI.completeness !== null && <p className="rounded-lg border border-slate-700 px-3 py-2">Completeness · {baseline.additionalWhoAmI.completeness}/3</p>}
                  {baseline.additionalWhoAmI.correctness !== null && <p className="rounded-lg border border-slate-700 px-3 py-2">Correctness · {baseline.additionalWhoAmI.correctness}/3</p>}
                </div>
              </div>
            )}
            {baseline.sources.some(source => source.feedback !== null) && (
              <div>
                <h4 className="font-bold text-slate-100">Baseline Feedback</h4>
                {baseline.sources.filter(source => source.feedback !== null).map(source => (
                  <div key={source.kind} className="mt-3 min-w-0">
                    <h5 className="text-sm font-semibold text-slate-100">{sourceName(source.kind)} Feedback</h5>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-300">{source.feedback}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
