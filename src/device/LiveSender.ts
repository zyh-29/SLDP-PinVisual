/**
 * Sends a live picture's pins (screen share or camera) to the board as they change.
 *
 *  - Only changes are sent: the same pins as the last pattern the board took are skipped.
 *  - One command at a time: while one is in flight (or another screen is sending), the newest pattern waits;
 *    patterns in between are dropped, so the board never falls behind the picture.
 *  - At most one send every `minIntervalMs`: the pins are moved by servos, which need time to get there, and a
 *    flicker of the picture shouldn't make them twitch.
 *
 * Pure logic over a small sink interface (DeviceController satisfies it), so it is unit tested with a fake board.
 */
import { type Pattern, patternsEqual } from '@/domain/pattern';
import type { CommandResult } from '@/protocol/CommandClient';

export interface PatternSink {
  sendPattern(pattern: Pattern): Promise<CommandResult>;
  readonly isBusy: boolean;
}

export interface LiveSendStatus {
  /** Patterns the board took since starting. */
  sent: number;
  /** The last send failed (the next change tries again). */
  lastError: string | null;
}

/** Servos take roughly this long to move a pin; sending faster only queues moves. */
export const LIVE_SEND_INTERVAL_MS = 600;

export class LiveSender {
  private latest: Pattern | null = null;
  private lastSent: Pattern | null = null;
  private lastAt = -Infinity;
  private sending = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  status: LiveSendStatus = { sent: 0, lastError: null };

  constructor(
    private readonly sink: PatternSink,
    private readonly onStatus: (s: LiveSendStatus) => void = () => {},
    private readonly minIntervalMs = LIVE_SEND_INTERVAL_MS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** The pins to show now. */
  push(pattern: Pattern) {
    if (this.stopped) return;
    this.latest = pattern;
    this.pump();
  }

  stop() {
    this.stopped = true;
    this.latest = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private later(ms: number) {
    if (this.timer || this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.pump();
    }, ms);
  }

  private pump() {
    const p = this.latest;
    if (this.stopped || this.sending || !p) return;
    if (this.lastSent && patternsEqual(p, this.lastSent)) return;
    const wait = this.lastAt + this.minIntervalMs - this.now();
    if (wait > 0) return this.later(wait);
    // Another screen's command (Send, Reset) is running: try again shortly.
    if (this.sink.isBusy) return this.later(this.minIntervalMs / 2);
    this.sending = true;
    this.lastAt = this.now();
    this.sink
      .sendPattern(p)
      .catch((e): CommandResult => ({ ok: false, commandId: null, attempts: 0, failure: 'write_failed', message: e instanceof Error ? e.message : String(e) }))
      .then((res) => {
        this.sending = false;
        if (this.stopped) return;
        if (res.ok) {
          this.lastSent = p;
          this.status = { sent: this.status.sent + 1, lastError: null };
        } else if (res.failure !== 'busy') this.status = { ...this.status, lastError: res.message };
        this.onStatus(this.status);
        // A newer pattern may have come in meanwhile.
        if (res.ok || res.failure === 'busy') this.pump();
      });
  }
}
