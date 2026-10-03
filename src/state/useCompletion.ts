import { useCallback, useEffect, useRef, useState } from 'react';

import type { Completion } from './usePaging';

/** What the coverage line says: still loading, stopped at a failed page, or stopped at the cap. */
export type CompletionStatus = 'running' | 'failed' | 'capped';

/**
 * Completes a stream in the background while a screen needs it whole, and says how far it got.
 *
 * **The results never wait for it.** The screen arranges what state holds at once; this only fetches
 * the rest and reports. No spinner gates anything: no request has a timeout, so one stuck request on
 * a weak signal would hold a results spinner open for good.
 *
 * - `needed` is the screen's own rule — a non-empty query or a non-default sort, over a live stream
 *   whose cursor is not `null` — so "complete" is derived from the cursor and never remembered. A
 *   re-read that leaves a complete stream with a cursor again (somebody added the 401st item) makes
 *   it needed again, and it runs again.
 * - Starts `run` when it becomes needed, and aborts it between pages when it stops being needed or
 *   the screen unmounts.
 * - **A `failed` run is restarted only when `readEpoch` moves** — a read succeeded, so the network is
 *   back — **or by `retry`** (`Try again`). Nothing else restarts it: typing does not, and an
 *   automatic retry offline would be a request loop.
 *
 * `status` is `null` whenever the stream is not needed: complete, or nobody asked.
 */
export function useCompletion(
  needed: boolean,
  run: (signal: AbortSignal) => Promise<Completion>,
  readEpoch: number
): { status: CompletionStatus | null; retry: () => void } {
  const [status, setStatus] = useState<CompletionStatus>('running');
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  useEffect(() => {
    if (!needed) return;

    const controller = new AbortController();
    setStatus('running');
    void run(controller.signal).then((outcome) => {
      if (controller.signal.aborted) return;
      if (outcome === 'failed' || outcome === 'capped') setStatus(outcome);
    });

    return () => controller.abort();
  }, [needed, run, attempt]);

  // Only a move counts, so the epoch this screen mounted with restarts nothing.
  const seen = useRef(readEpoch);
  useEffect(() => {
    if (readEpoch === seen.current) return;
    seen.current = readEpoch;
    if (status === 'failed') retry();
  }, [readEpoch, status, retry]);

  return { status: needed ? status : null, retry };
}
