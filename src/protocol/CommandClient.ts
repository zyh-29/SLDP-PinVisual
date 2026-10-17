import { PROTOCOL } from '@/config/hardware';
import type { Transport } from '@/device/types';
import { chunkMessage } from './chunking';
import {
  ACK_STATUS_TEXT,
  AckStatus,
  type Command,
  decodeAck,
  encodeCommand,
  isRetryableStatus,
  MAX_COMMAND_ID,
  MessageType,
} from './messages';

export type CommandFailure =
  | 'timeout' // no acknowledgement after every attempt
  | 'rejected' // board answered with a non-retryable error status
  | 'write_failed' // the BLE write itself kept failing
  | 'busy' // another command is already in flight
  | 'invalid'; // the command could not be encoded

export type CommandResult =
  | { ok: true; commandId: number; attempts: number }
  | { ok: false; commandId: number | null; attempts: number; failure: CommandFailure; message: string; status?: number };

export interface CommandProgress {
  commandId: number;
  attempt: number;
  maxAttempts: number;
  phase: 'writing' | 'awaiting_ack' | 'retry_wait';
}

export interface CommandClientOptions {
  ackTimeoutMs?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
  /** First command ID to use (tests); defaults to a random start so reconnects don't reuse IDs. */
  firstCommandId?: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Sends one command at a time, chunked to the link's write size, and only
 * reports success when an Ack with the same command ID and status OK arrives.
 * Retries resend the identical bytes with the same command ID so the board can
 * de-duplicate (see docs/PROTOCOL.md).
 */
export class CommandClient {
  private nextId: number;
  private inFlight = false;
  private readonly ackTimeoutMs: number;
  private readonly maxAttempts: number;
  private readonly retryDelayMs: number;

  constructor(
    private readonly transport: Transport,
    options: CommandClientOptions = {},
  ) {
    this.ackTimeoutMs = options.ackTimeoutMs ?? PROTOCOL.ackTimeoutMs;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? PROTOCOL.maxAttempts);
    this.retryDelayMs = options.retryDelayMs ?? PROTOCOL.retryDelayMs;
    this.nextId = options.firstCommandId ?? 1 + Math.floor(Math.random() * (MAX_COMMAND_ID - 1));
  }

  get busy(): boolean {
    return this.inFlight;
  }

  private allocateId(): number {
    const id = this.nextId;
    this.nextId = id >= MAX_COMMAND_ID ? 1 : id + 1;
    return id;
  }

  async send(command: Command, onProgress?: (p: CommandProgress) => void): Promise<CommandResult> {
    if (this.inFlight) {
      return { ok: false, commandId: null, attempts: 0, failure: 'busy', message: 'Another command is still in progress.' };
    }
    this.inFlight = true;
    try {
      return await this.run(command, onProgress);
    } finally {
      this.inFlight = false;
    }
  }

  private async run(command: Command, onProgress?: (p: CommandProgress) => void): Promise<CommandResult> {
    const commandId = this.allocateId();
    const expectedType = command.kind === 'pattern' ? MessageType.SetPattern : MessageType.Reset;
    let chunks: Uint8Array[];
    try {
      chunks = chunkMessage(commandId, encodeCommand(commandId, command), this.transport.maxWriteSize);
    } catch (e) {
      return { ok: false, commandId, attempts: 0, failure: 'invalid', message: errorText(e) };
    }

    let lastFailure: CommandResult | null = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      if (attempt > 1) {
        onProgress?.({ commandId, attempt, maxAttempts: this.maxAttempts, phase: 'retry_wait' });
        await sleep(this.retryDelayMs);
      }

      // Listen before writing: the ack can arrive before the final write resolves.
      const ack = this.waitForAck(commandId, expectedType);
      try {
        onProgress?.({ commandId, attempt, maxAttempts: this.maxAttempts, phase: 'writing' });
        for (const chunk of chunks) await this.transport.write(chunk);
      } catch (e) {
        ack.cancel();
        lastFailure = {
          ok: false,
          commandId,
          attempts: attempt,
          failure: 'write_failed',
          message: `Bluetooth write failed: ${errorText(e)}`,
        };
        continue;
      }

      onProgress?.({ commandId, attempt, maxAttempts: this.maxAttempts, phase: 'awaiting_ack' });
      const status = await ack.start();
      if (status === AckStatus.Ok) return { ok: true, commandId, attempts: attempt };
      if (status === null) {
        lastFailure = {
          ok: false,
          commandId,
          attempts: attempt,
          failure: 'timeout',
          message: `No acknowledgement from the board after ${attempt} attempt${attempt === 1 ? '' : 's'}.`,
        };
        continue;
      }
      const text = ACK_STATUS_TEXT[status] ?? `Board returned unknown status 0x${status.toString(16)}`;
      lastFailure = { ok: false, commandId, attempts: attempt, failure: 'rejected', message: text, status };
      if (!isRetryableStatus(status)) return lastFailure;
    }
    return lastFailure!;
  }

  /** Resolves with the ack status, or null on timeout. Ignores unrelated or malformed notifications. */
  private waitForAck(commandId: number, expectedType: number) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    let resolveFn: (v: number | null) => void = () => {};
    const promise = new Promise<number | null>((resolve) => (resolveFn = resolve));

    const settle = (v: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      resolveFn(v);
    };
    const unsubscribe = this.transport.onReceive((bytes) => {
      const ack = decodeAck(bytes);
      if (!ack || ack.commandId !== commandId || ack.ackedType !== expectedType) return;
      settle(ack.status);
    });

    return {
      /** Starts the timeout (after writing finished, so slow chunked writes don't eat into it). */
      start: (): Promise<number | null> => {
        if (!settled) timer = setTimeout(() => settle(null), this.ackTimeoutMs);
        return promise;
      },
      cancel: () => settle(null),
    };
  }
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
