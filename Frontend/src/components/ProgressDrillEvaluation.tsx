import { useState } from 'react';
import { getProgressDrillEvaluations, progressDrillCriteria } from '../utils/analytics';
import { getDrillTitle } from './DrillsPage';

const formatCompletedAt = (value: string | null, short = false): string | null => {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  const date = new Date(value);
  return short ? date.toLocaleDateString() : date.toLocaleString();
};

export function ProgressDrillEvaluationSection({ records }: { records: Array<Record<string, unknown>> }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const recentEvaluations = getProgressDrillEvaluations(records).slice(0, 8);
  const selected = recentEvaluations.find(item => item.id === selectedId) ?? recentEvaluations[0] ?? null;

  return (
    <section aria-labelledby="progress-drill-evaluation-heading" className="rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-xl md:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 id="progress-drill-evaluation-heading" className="text-xl font-bold italic tracking-tight text-slate-100">Drill Evaluation</h3>
          <p className="mt-1 text-sm text-slate-400">Completed, server-evaluated Drill results.</p>
        </div>
        {recentEvaluations.length > 1 && selected && (
          <div className="w-full min-w-0 sm:max-w-xs">
            <label htmlFor="progress-drill-evaluation-select" className="mb-1 block text-xs font-bold text-slate-300">Choose a completed Drill</label>
            <select
              id="progress-drill-evaluation-select"
              value={selected.id}
              onChange={event => setSelectedId(Number(event.target.value))}
              className="program-accent-focus-ring min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100"
            >
              {recentEvaluations.map(item => (
                <option key={item.id} value={item.id}>{getDrillTitle(item.drillType)} · {formatCompletedAt(item.completedAt, true) ?? 'Date unavailable'}</option>
              ))}
            </select>
          </div>
        )}
      </div>
      {selected ? (
        <div className="mt-5 min-w-0 space-y-4" aria-live="polite">
          <div>
            <h4 className="text-lg font-bold text-slate-100">{getDrillTitle(selected.drillType)}</h4>
            <p className="mt-1 text-xs text-slate-400">
              {formatCompletedAt(selected.completedAt) ? `Completed ${formatCompletedAt(selected.completedAt)}` : 'Completion date unavailable'}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="min-w-0 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Overall score</p>
              <p className="mt-1 text-2xl font-black text-slate-100" aria-label={`Overall score: ${selected.score} percent`}>{selected.score}%</p>
            </div>
            <div className="min-w-0 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Result</p>
              <p className="mt-1 text-base font-bold text-slate-100">
                {selected.passed === null ? 'Result unavailable' : selected.passed ? 'Passed' : 'Needs more practice'}
              </p>
            </div>
          </div>
          <div className="min-w-0 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
            <h4 className="text-sm font-bold text-slate-100">Feedback</h4>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-300">
              {selected.feedbackSummary ?? 'No detailed feedback is available for this Drill.'}
            </p>
          </div>
          {selected.criteria && (
            <div className="min-w-0 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
              <h4 className="text-sm font-bold text-slate-100">Performance breakdown</h4>
              <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                {progressDrillCriteria.map(key => (
                  <div key={key} className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-slate-800 px-3 py-2 text-sm text-slate-300">
                    <dt className="break-words">{key === 'task_completion' ? 'Task completion' : key.charAt(0).toUpperCase() + key.slice(1)}</dt>
                    <dd className="shrink-0 font-bold text-slate-100">{selected.criteria?.[key]} / 5</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          {selected.authority && (
            <p className="text-xs text-slate-400">
              Evaluation source: {selected.authority === 'deterministic_fallback' ? 'Deterministic fallback' : 'AI-assisted assessment'}
            </p>
          )}
        </div>
      ) : (
        <p className="mt-5 text-sm text-slate-400">Complete a Drill to see your detailed evaluation here.</p>
      )}
    </section>
  );
}
