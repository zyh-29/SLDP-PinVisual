import { GRID } from '@/config/hardware';
import { createEmptyPattern, togglePin } from '@/domain/pattern';
import { base64ToBytes, bytesToBase64 } from '../base64';
import { ChunkReassembler, chunkMessage, maxWriteSizeForMtu } from '../chunking';
import { crc16 } from '../crc16';
import {
  AckStatus,
  decodeAck,
  decodeMessage,
  encodeAck,
  encodeReset,
  encodeSetPattern,
  MessageType,
  validateSetPatternPayload,
} from '../messages';

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');

describe('crc16 (CCITT-FALSE)', () => {
  it('matches the standard check value', () => {
    expect(crc16(new TextEncoder().encode('123456789'))).toBe(0x29b1);
  });
});

describe('message encoding', () => {
  // These byte strings are copied into docs/PROTOCOL.md as firmware test vectors.
  it('encodes SET_PATTERN (5x6, pins 0 and 29 raised) exactly', () => {
    let p = createEmptyPattern(5, 6);
    p = togglePin(p, 0, 0);
    p = togglePin(p, 4, 5);
    const msg = encodeSetPattern(1, p);
    expect(hex(msg)).toBe('01 01 01 00 06 00 05 06 01 00 00 20 19 6c');
    expect(msg.length).toBe(14);
    expect(msg[12] | (msg[13] << 8)).toBe(crc16(msg, 0, 12));
  });

  it('encodes SET_PATTERN for other grid sizes too (5x8, pins 0 and 39 raised)', () => {
    let p = createEmptyPattern(5, 8);
    p = togglePin(p, 0, 0);
    p = togglePin(p, 4, 7);
    const msg = encodeSetPattern(1, p);
    expect(hex(msg)).toBe('01 01 01 00 07 00 05 08 01 00 00 00 80 c4 48');
  });

  it('encodes RESET with an empty payload', () => {
    const msg = encodeReset(0x1234);
    expect(Array.from(msg.slice(0, 6))).toEqual([0x01, 0x02, 0x34, 0x12, 0x00, 0x00]);
    expect(msg.length).toBe(8);
  });

  it('rejects invalid command IDs and patterns', () => {
    expect(() => encodeReset(0)).toThrow();
    expect(() => encodeReset(70000)).toThrow();
    expect(() => encodeSetPattern(1, { rows: 2, cols: 2, cells: [0, 1] })).toThrow(/Expected 4/);
  });

  it('prints test vectors for the firmware docs', () => {
    let p = createEmptyPattern(5, 6);
    p = togglePin(p, 0, 0);
    p = togglePin(p, 4, 5);
    const vectors = {
      setPattern: hex(encodeSetPattern(1, p)),
      reset: hex(encodeReset(2)),
      ackOk: hex(encodeAck(1, MessageType.SetPattern, AckStatus.Ok)),
      ackResetOk: hex(encodeAck(2, MessageType.Reset, AckStatus.Ok)),
    };
    expect(vectors).toMatchSnapshot();
  });
});

describe('message validation', () => {
  const good = encodeSetPattern(7, createEmptyPattern(5, 8));

  it('decodes a valid message', () => {
    const res = decodeMessage(good);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.message.commandId).toBe(7);
      expect(res.message.type).toBe(MessageType.SetPattern);
      expect(res.message.payload.length).toBe(7);
    }
  });

  it('detects corruption via CRC', () => {
    const bad = good.slice();
    bad[8] ^= 0x01;
    expect(decodeMessage(bad)).toMatchObject({ ok: false, status: AckStatus.CrcMismatch });
  });

  it('detects truncated or padded messages', () => {
    expect(decodeMessage(good.slice(0, good.length - 1))).toMatchObject({ ok: false, status: AckStatus.BadLength });
    expect(decodeMessage(new Uint8Array([...good, 0]))).toMatchObject({ ok: false, status: AckStatus.BadLength });
    expect(decodeMessage(new Uint8Array(3))).toMatchObject({ ok: false, status: AckStatus.BadLength });
  });

  it('validates SET_PATTERN dimensions against the board', () => {
    const payload = decodeMessage(good);
    if (!payload.ok) throw new Error('expected ok');
    expect(validateSetPatternPayload(payload.message.payload, 5, 8).ok).toBe(true);
    expect(validateSetPatternPayload(payload.message.payload, 6, 8)).toEqual({
      ok: false,
      status: AckStatus.DimensionMismatch,
    });
    expect(validateSetPatternPayload(Uint8Array.of(5, 8, 0), 5, 8)).toEqual({ ok: false, status: AckStatus.BadLength });
  });

  it('parses acks and ignores anything that is not a well-formed ack', () => {
    expect(decodeAck(encodeAck(9, MessageType.Reset, AckStatus.Busy))).toEqual({
      commandId: 9,
      ackedType: MessageType.Reset,
      status: AckStatus.Busy,
    });
    expect(decodeAck(encodeReset(9))).toBeNull(); // wrong type
    const corrupt = encodeAck(9, MessageType.Reset, AckStatus.Ok);
    corrupt[7] ^= 0xff;
    expect(decodeAck(corrupt)).toBeNull();
  });
});

describe('chunking', () => {
  it('derives write size from MTU', () => {
    expect(maxWriteSizeForMtu(23)).toBe(20);
    expect(maxWriteSizeForMtu(185)).toBe(182);
    expect(maxWriteSizeForMtu(10)).toBe(20); // never below the BLE minimum
    expect(maxWriteSizeForMtu(1000)).toBe(512);
  });

  it('splits a large message so every write fits, and reassembles it', () => {
    const big = { rows: 32, cols: 32, cells: Array.from({ length: 1024 }, (_, i) => (i % 3 === 0 ? 1 : 0) as 0 | 1) };
    const msg = encodeSetPattern(300, big); // 6 + 2 + 128 + 2 = 138 bytes
    const chunks = chunkMessage(300, msg, 20);
    expect(chunks.length).toBe(Math.ceil(138 / 16));
    chunks.forEach((c) => expect(c.length).toBeLessThanOrEqual(20));
    chunks.forEach((c, i) => expect(Array.from(c.slice(0, 4))).toEqual([300 & 0xff, 300 >> 8, i, chunks.length]));

    const r = new ChunkReassembler();
    const events = chunks.map((c) => r.push(c));
    const last = events.pop()!;
    events.forEach((e) => expect(e.type).toBe('incomplete'));
    expect(last).toEqual({ type: 'complete', commandId: 300, message: msg });
  });

  it("sends the board's pattern in a single 20-byte write", () => {
    const msg = encodeSetPattern(1, createEmptyPattern(GRID.rows, GRID.cols));
    expect(chunkMessage(1, msg, 20)).toHaveLength(1);
  });

  it('discards out-of-order chunks and restarts on a new first chunk', () => {
    const msg = encodeSetPattern(5, { rows: 8, cols: 8, cells: new Array(64).fill(1) });
    const chunks = chunkMessage(5, msg, 8);
    const r = new ChunkReassembler();
    r.push(chunks[0]);
    expect(r.push(chunks[2]).type).toBe('error');
    // A fresh retry from chunk 0 still succeeds.
    const results = chunks.map((c) => r.push(c));
    expect(results[results.length - 1]).toMatchObject({ type: 'complete', commandId: 5 });
  });

  it('refuses messages that need more than 255 chunks', () => {
    expect(() => chunkMessage(1, new Uint8Array(300), 5)).toThrow(/255/);
  });
});

describe('base64', () => {
  it('round-trips arbitrary bytes', () => {
    for (const len of [0, 1, 2, 3, 4, 19, 20, 255]) {
      const bytes = Uint8Array.from({ length: len }, (_, i) => (i * 37 + 11) & 0xff);
      expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
    }
    expect(bytesToBase64(Uint8Array.of(0xde, 0xad, 0xbe, 0xef))).toBe('3q2+7w==');
  });
});
