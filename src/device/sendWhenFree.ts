import type { CommandResult } from '@/protocol/CommandClient';

/**
 * Sends a command, asking again while the board is busy with an earlier one (for example the step before, when
 * the user skips ahead in a sequence). Resolves with the board's answer, or null once `cancelled()` is true
 * (nothing is sent after that).
 */
export async function sendWhenFree(
  send: () => Promise<CommandResult>,
  {
    cancelled,
    retryMs = 300,
    giveUpMs = 30_000,
    now = Date.now,
    wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  }: {
    cancelled: () => boolean;
    retryMs?: number;
    /** After this long, a busy answer is given back as it is. */
    giveUpMs?: number;
    now?: () => number;
    wait?: (ms: number) => Promise<void>;
  },
): Promise<CommandResult | null> {
  const started = now();
  for (;;) {
    if (cancelled()) return null;
    const res = await send();
    if (cancelled()) return null;
    if (res.ok || res.failure !== 'busy' || now() - started >= giveUpMs) return res;
    await wait(retryMs);
  }
}
