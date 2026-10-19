import { createEmptyPattern, type Pattern, unpackPins } from '@/domain/pattern';
import { ChunkReassembler } from '@/protocol/chunking';
import {
  AckStatus,
  decodeMessage,
  encodeAck,
  MessageType,
  validateSetPatternPayload,
} from '@/protocol/messages';

/** How the simulated board misbehaves, for exercising error paths. */
export type MockBehavior =
  | 'normal'
  | 'slow' // acks after a long delay (still inside the timeout)
  | 'drop_first_ack' // ignores the first attempt of each command, so the app retries
  | 'never_ack' // never answers -> timeout
  | 'reject'; // answers with HardwareFault

export interface MockFirmwareOptions {
  rows: number;
  cols: number;
  behavior?: MockBehavior;
  ackDelayMs?: number;
}

/**
 * A software model of the ESP32 firmware described in docs/PROTOCOL.md.
 * It reassembles chunks, validates messages, de-duplicates retried command IDs
 * and replies with Acks. Its pin state is simulated - there is no hardware.
 */
export class MockFirmware {
  readonly rows: number;
  readonly cols: number;
  behavior: MockBehavior;
  ackDelayMs: number;

  private reassembler = new ChunkReassembler();
  private pins: Pattern;
  private lastCommand: { id: number; type: number; status: number } | null = null;
  private seenAttempts = new Map<number, number>();
  private listeners = new Set<() => void>();

  constructor(
    options: MockFirmwareOptions,
    private readonly sendToApp: (bytes: Uint8Array) => void,
  ) {
    this.rows = options.rows;
    this.cols = options.cols;
    this.behavior = options.behavior ?? 'normal';
    this.ackDelayMs = options.ackDelayMs ?? 150;
    this.pins = createEmptyPattern(this.rows, this.cols);
  }

  /** Simulated pin state ("what the servos would have been told"). */
  get simulatedPins(): Pattern {
    return this.pins;
  }

  /** Number of SET_PATTERN / RESET commands actually applied (dedup-aware). */
  appliedCount = 0;

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  receiveChunk(chunk: Uint8Array) {
    const event = this.reassembler.push(chunk);
    if (event.type !== 'complete') return; // incomplete, or a bad chunk that was dropped
    this.handleMessage(event.commandId, event.message);
  }

  private handleMessage(chunkCommandId: number, bytes: Uint8Array) {
    const decoded = decodeMessage(bytes);
    if (!decoded.ok) {
      // Firmware can still reply when the header is readable.
      const type = bytes.length > 1 ? bytes[1] : 0;
      this.reply(chunkCommandId, type, decoded.status);
      return;
    }
    const { commandId, type, payload } = decoded.message;

    const attempts = (this.seenAttempts.get(commandId) ?? 0) + 1;
    this.seenAttempts.set(commandId, attempts);
    if (this.seenAttempts.size > 32) this.seenAttempts.delete(this.seenAttempts.keys().next().value!);

    if (this.behavior === 'never_ack') return;
    if (this.behavior === 'drop_first_ack' && attempts === 1) return;

    // Retry of the command we just applied: re-send the same ack, don't re-actuate.
    if (this.lastCommand && this.lastCommand.id === commandId && this.lastCommand.type === type) {
      this.reply(commandId, type, this.lastCommand.status);
      return;
    }

    let status: number;
    if (this.behavior === 'reject') {
      status = AckStatus.HardwareFault;
    } else if (type === MessageType.SetPattern) {
      const v = validateSetPatternPayload(payload, this.rows, this.cols);
      if (v.ok) {
        this.pins = unpackPins(v.bits, v.rows, v.cols);
        this.appliedCount++;
        status = AckStatus.Ok;
      } else {
        status = v.status;
      }
    } else if (type === MessageType.Reset) {
      if (payload.length !== 0) {
        status = AckStatus.BadLength;
      } else {
        this.pins = createEmptyPattern(this.rows, this.cols);
        this.appliedCount++;
        status = AckStatus.Ok;
      }
    } else {
      status = AckStatus.UnknownType;
    }
    this.lastCommand = { id: commandId, type, status };
    this.listeners.forEach((l) => l());
    this.reply(commandId, type, status);
  }

  private reply(commandId: number, type: number, status: number) {
    if (commandId === 0) return;
    const delay = this.behavior === 'slow' ? Math.max(this.ackDelayMs, 1500) : this.ackDelayMs;
    const ack = encodeAck(commandId, type, status);
    setTimeout(() => this.sendToApp(ack), delay);
  }
}
