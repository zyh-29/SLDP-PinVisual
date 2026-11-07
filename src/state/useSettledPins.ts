import { useEffect, useRef } from 'react';

import type { Pattern } from '@/domain/pattern';

/** How long a waiter holds on for a picture that never settles (it failed to load, or another replaced it). */
export const SETTLE_TIMEOUT_MS = 8000;

/**
 * Lets voice wait for a picture's pins. A picture is settled once it's loaded and nothing is still being worked out
 * for it (Smart Cut-Out, the numbers on a graph's axes). Returns `waitFor(uri)`, which resolves with the pins then,
 * or null after SETTLE_TIMEOUT_MS.
 */
export function useSettledPins(settled: boolean, uri: string | undefined, shown: Pattern | null) {
  const waiters = useRef<{ uri: string; resolve: (p: Pattern | null) => void }[]>([]);
  useEffect(() => {
    if (!settled || uri === undefined) return;
    const ready = waiters.current.filter((w) => w.uri === uri);
    if (!ready.length) return;
    waiters.current = waiters.current.filter((w) => w.uri !== uri);
    ready.forEach((w) => w.resolve(shown ?? null));
  }, [settled, uri, shown]);

  return (want: string) =>
    new Promise<Pattern | null>((resolve) => {
      if (settled && uri === want) return resolve(shown ?? null);
      const waiter = { uri: want, resolve };
      waiters.current.push(waiter);
      setTimeout(() => {
        if (!waiters.current.includes(waiter)) return;
        waiters.current = waiters.current.filter((w) => w !== waiter);
        resolve(null);
      }, SETTLE_TIMEOUT_MS);
    });
}
