export type UpdateBlockReason = 'active-session' | 'unsynced-work' | 'checking-work' | null;

interface AppUpdateNoticeProps {
  available: boolean;
  blockedReason: UpdateBlockReason;
  isRefreshing: boolean;
  error: string | null;
  onRefresh: () => void;
  onCheckAgain?: () => void;
}

export function AppUpdateNotice({
  available,
  blockedReason,
  isRefreshing,
  error,
  onRefresh,
  onCheckAgain,
}: AppUpdateNoticeProps) {
  if (!available) return null;

  const guidance = blockedReason === 'active-session'
    ? 'Finish your current activity before refreshing.'
    : blockedReason === 'unsynced-work'
      ? 'Finish or sync your saved offline work before refreshing.'
      : blockedReason === 'checking-work'
        ? 'Checking saved work before refreshing.'
        : 'Refresh when you are ready.';

  return (
    <aside
      role="status"
      aria-live="polite"
      className={`fixed z-[9998] w-80 max-w-[calc(100vw-1.5rem)] rounded-xl border border-slate-600 bg-slate-950/95 p-4 text-sm text-slate-100 shadow-xl ${blockedReason === 'active-session' ? 'left-3 top-20 sm:left-4' : 'right-3 top-28 sm:right-4'}`}
    >
      <p className="font-bold">A new Career Edge version is available.</p>
      <p className="mt-1 text-slate-300">{guidance}</p>
      {error && <p className="mt-2 text-amber-200">{error}</p>}
      {blockedReason === null && (
        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          className="mt-3 min-h-11 rounded-lg bg-white px-4 py-2 font-semibold text-slate-950 hover:bg-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isRefreshing ? 'Preparing update…' : 'Refresh now'}
        </button>
      )}
      {(blockedReason === 'unsynced-work' || (blockedReason === 'checking-work' && error)) && onCheckAgain && (
        <button
          type="button"
          onClick={onCheckAgain}
          className="mt-3 min-h-11 rounded-lg border border-slate-500 px-4 py-2 font-semibold text-slate-100 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          Check again
        </button>
      )}
    </aside>
  );
}
