import { useEffect, useMemo, useRef, useState } from 'react';
import { PostTestEvaluationResult } from './PostTestEvaluationResult';
import {
  fetchPostTestHistoryDetail, PostTestHistoryFetchError, readPostTestHistoryDisplay,
  type PostTestHistoryDisplay,
} from '../utils/postTestHistory';

type HistoryRecord = Record<string, unknown>;
type HistoryState = 'idle' | 'loading' | 'ready' | 'error';
export type CompletedPostTest = {
  id: number;
  completedAt: string | null;
  passed: boolean | null;
};

const completedTime = (value: string | null): number => value ? Date.parse(value) || 0 : 0;

/** Only authoritative completed server records belong in the Progress selector. */
export function getProgressPostTestSessions(records: readonly HistoryRecord[]): CompletedPostTest[] {
  return records.flatMap(record => {
    if (record._source !== 'post-test-interview' || record.status !== 'completed'
      || typeof record.id !== 'number' || !Number.isSafeInteger(record.id) || record.id < 1) return [];
    const completedAt = typeof record.end_time === 'string' && Number.isFinite(Date.parse(record.end_time))
      ? record.end_time : null;
    return [{ id: record.id, completedAt, passed: typeof record.passed === 'boolean' ? record.passed : null }];
  }).sort((first, second) => completedTime(second.completedAt) - completedTime(first.completedAt) || second.id - first.id)
    .slice(0, 8);
}

type LoadedDetail = { userId: number; id: number; display: PostTestHistoryDisplay };
type DetailError = { userId: number; id: number; message: string };

export function ProgressPostTestEvaluationSection({
  records, historyState, historyOwnerId, userId, apiUrl, effectiveOnline,
}: {
  records: readonly HistoryRecord[];
  historyState: HistoryState;
  historyOwnerId: number | null;
  userId: number | null;
  apiUrl: string;
  effectiveOnline: boolean;
}) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<LoadedDetail | null>(null);
  const detailRef = useRef<LoadedDetail | null>(null);
  const [error, setError] = useState<DetailError | null>(null);
  const [loading, setLoading] = useState(false);
  const requestGenerationRef = useRef(0);
  const sessions = useMemo(() => getProgressPostTestSessions(
    userId !== null && historyOwnerId === userId ? records : [],
  ), [records, historyOwnerId, userId]);
  const selected = sessions.find(session => session.id === selectedId) ?? sessions[0] ?? null;

  useEffect(() => {
    setSelectedId(null);
    setDetail(null);
    detailRef.current = null;
    setError(null);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    if (!selected || userId === null || historyOwnerId !== userId) {
      setLoading(false);
      return;
    }
    if (detailRef.current?.userId === userId && detailRef.current.id === selected.id) return;
    const generation = ++requestGenerationRef.current;
    const controller = new AbortController();
    detailRef.current = null;
    setDetail(null);
    setError(null);
    if (!effectiveOnline) {
      setLoading(false);
      setError({ userId, id: selected.id, message: 'Post-Test evaluation details are unavailable while offline. Reconnect and try again.' });
      return () => { controller.abort(); requestGenerationRef.current += 1; };
    }
    const token = localStorage.getItem('token');
    if (!token) {
      setLoading(false);
      setError({ userId, id: selected.id, message: 'Your session could not be verified. Please sign in again.' });
      return () => { controller.abort(); requestGenerationRef.current += 1; };
    }
    setLoading(true);
    void fetchPostTestHistoryDetail(apiUrl, selected.id, token, controller.signal).then(raw => {
      if (controller.signal.aborted || generation !== requestGenerationRef.current) return;
      const display = readPostTestHistoryDisplay(raw, selected.id);
      if (!display) throw new Error('This Post-Test evaluation is unavailable.');
      const loaded = { userId, id: selected.id, display };
      detailRef.current = loaded;
      setDetail(loaded);
    }).catch(cause => {
      if (controller.signal.aborted || generation !== requestGenerationRef.current) return;
      const message = cause instanceof PostTestHistoryFetchError
        ? cause.status === 404 ? 'This Post-Test evaluation is no longer available.'
          : cause.status === 403 ? 'You do not have access to this Post-Test evaluation.'
            : 'Unable to load this Post-Test evaluation. Please try again.'
        : cause instanceof TypeError ? 'Unable to reach the server. Check your connection and try again.'
          : 'This Post-Test evaluation is unavailable.';
      setError({ userId, id: selected.id, message });
    }).finally(() => {
      if (!controller.signal.aborted && generation === requestGenerationRef.current) setLoading(false);
    });
    return () => { controller.abort(); requestGenerationRef.current += 1; };
  }, [apiUrl, effectiveOnline, historyOwnerId, selected?.id, userId]);

  const currentDetail = detail?.userId === userId && detail.id === selected?.id ? detail.display : null;
  const currentError = error?.userId === userId && error.id === selected?.id ? error.message : null;

  return (
    <section aria-labelledby="progress-post-test-evaluation-heading" className="min-w-0 rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-xl md:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 id="progress-post-test-evaluation-heading" className="text-xl font-bold italic tracking-tight text-slate-100">Post-Test Evaluation</h3>
          <p className="mt-1 text-sm text-slate-400">Completed, server-evaluated Post-Test results.</p>
        </div>
        {sessions.length > 1 && selected && (
          <div className="w-full min-w-0 sm:max-w-xs">
            <label htmlFor="progress-post-test-select" className="mb-1 block text-xs font-bold text-slate-300">Post-Test Session</label>
            <select id="progress-post-test-select" value={selected.id} onChange={event => setSelectedId(Number(event.target.value))}
              className="program-accent-focus-ring min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100">
              {sessions.map(session => (
                <option key={session.id} value={session.id}>
                  {session.completedAt ? new Date(session.completedAt).toLocaleString() : 'Date unavailable'} · {session.passed === null ? 'Result unavailable' : session.passed ? 'Passed' : 'Needs more practice'}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      {!selected ? (
        <p className="mt-5 text-sm text-slate-400" role={historyState === 'error' ? 'alert' : 'status'}>
          {historyState === 'error' ? 'Post-Test history could not be loaded. Check your connection and try again.'
            : historyState === 'loading' || (userId !== null && historyOwnerId !== userId)
              ? 'Loading Post-Test history...' : 'No completed Post-Test evaluation is available yet.'}
        </p>
      ) : (
        <div className="mt-5 min-w-0 space-y-4">
          <h4 className="text-lg font-bold text-slate-100">Selected Post-Test session</h4>
          {currentDetail ? (
            <PostTestEvaluationResult embedded result={currentDetail.result}
              questions={currentDetail.pairs.map(pair => pair.question)}
              answers={currentDetail.pairs.map(pair => pair.answer)}
              aggregateCriteria={currentDetail.aggregateCriteria}
              completedAt={currentDetail.completedAt} detailNotice={currentDetail.detailNotice} />
          ) : currentError ? <p role="alert" className="text-sm text-slate-300">{currentError}</p>
            : <p role="status" className="text-sm text-slate-300">{loading ? 'Loading Post-Test evaluation...' : 'Preparing Post-Test evaluation...'}</p>}
        </div>
      )}
    </section>
  );
}
