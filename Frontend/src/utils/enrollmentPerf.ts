export type EnrollmentPerfEvent =
  | 'micStop'
  | 'canonicalTranscriptReady'
  | 'recorderStopStart'
  | 'recorderStopEnd'
  | 'transcriptionStart'
  | 'transcriptionEnd'
  | 'checkpointStart'
  | 'checkpointEnd'
  | 'websocketSendStart'
  | 'websocketSend'
  | 'frontendFirstChunk'
  | 'turnCompleteReceived'
  | 'ttsRequested'
  | 'ttsStart';

const EVENTS: ReadonlySet<string> = new Set<EnrollmentPerfEvent>([
  'micStop', 'canonicalTranscriptReady', 'recorderStopStart', 'recorderStopEnd',
  'transcriptionStart', 'transcriptionEnd', 'checkpointStart', 'checkpointEnd',
  'websocketSendStart', 'websocketSend', 'frontendFirstChunk',
  'turnCompleteReceived', 'ttsRequested', 'ttsStart',
]);

export const enrollmentPerfEnabled = () =>
  import.meta.env.DEV && import.meta.env.VITE_ENROLLMENT_PERF_DEBUG === 'true';

export class EnrollmentPerfTrace {
  readonly id: string;
  private origin: number | null = null;
  private readonly marks = new Map<EnrollmentPerfEvent, number>();

  constructor(
    private readonly now: () => number = () => performance.now(),
    private readonly write: (message: string) => void = message => console.info(message),
    id?: string,
  ) {
    const bytes = new Uint8Array(6);
    if (!id) globalThis.crypto.getRandomValues(bytes);
    this.id = id ?? Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    if (!/^[0-9a-f]{12}$/.test(this.id)) throw new Error('Invalid Enrollment timing ID.');
  }

  mark(event: EnrollmentPerfEvent): void {
    if (!EVENTS.has(event)) return;
    const time = this.now();
    if (this.origin === null || event === 'micStop') this.origin = time;
    this.marks.set(event, time);
    try {
      this.write(`[EnrollmentPerf] turn=${this.id} ${event} +${(time - this.origin).toFixed(1)}ms`);
    } catch { /* Diagnostics must never interrupt the interview. */ }
  }

  markOnce(event: EnrollmentPerfEvent): void {
    if (!this.marks.has(event)) this.mark(event);
  }

  transcriptionUsed(used: boolean): void {
    try {
      this.write(`[EnrollmentPerf] turn=${this.id} transcriptionUsed=${used === true}`);
    } catch { /* Diagnostics must never interrupt the interview. */ }
  }

  duration(start: EnrollmentPerfEvent, end: EnrollmentPerfEvent): number | null {
    const first = this.marks.get(start);
    const last = this.marks.get(end);
    return first === undefined || last === undefined ? null : last - first;
  }
}
