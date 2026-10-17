import { createEmptyPattern, togglePin } from '@/domain/pattern';
import { MockFirmware, type MockBehavior } from '@/device/mock/MockFirmware';
import type { Transport } from '@/device/types';
import { CommandClient } from '../CommandClient';
import { AckStatus, encodeAck, MessageType } from '../messages';

/** Transport wired to the reference firmware model, like a real BLE link. */
function loopback(behavior: MockBehavior = 'normal', maxWriteSize = 20) {
  const receivers = new Set<(b: Uint8Array) => void>();
  const deliver = (b: Uint8Array) => receivers.forEach((r) => r(b));
  const firmware = new MockFirmware({ rows: 5, cols: 8, behavior, ackDelayMs: 5 }, deliver);
  const writes: Uint8Array[] = [];
  const transport: Transport = {
    maxWriteSize,
    async write(bytes) {
      writes.push(bytes);
      firmware.receiveChunk(bytes);
    },
    onReceive(l) {
      receivers.add(l);
      return () => receivers.delete(l);
    },
  };
  return { transport, firmware, writes, deliver, receivers };
}

const fast = { ackTimeoutMs: 60, retryDelayMs: 5, maxAttempts: 3, firstCommandId: 1 };
const pattern = togglePin(togglePin(createEmptyPattern(5, 8), 0, 0), 2, 3);

describe('CommandClient acknowledgement handling', () => {
  it('succeeds only after a matching ack and the board applies the pattern', async () => {
    const { transport, firmware } = loopback();
    const client = new CommandClient(transport, fast);
    const res = await client.send({ kind: 'pattern', pattern });
    expect(res).toEqual({ ok: true, commandId: 1, attempts: 1 });
    expect(firmware.simulatedPins).toEqual(pattern);
  });

  it('does not treat a completed write as success when no ack arrives', async () => {
    const { transport, writes } = loopback('never_ack');
    const client = new CommandClient(transport, fast);
    const res = await client.send({ kind: 'pattern', pattern });
    expect(writes).toHaveLength(3); // every write "succeeded"...
    expect(res).toMatchObject({ ok: false, failure: 'timeout', attempts: 3 }); // ...but no ack -> failure
  });

  it('retries with the same command ID and the board applies it only once', async () => {
    const { transport, firmware, writes } = loopback('drop_first_ack');
    const client = new CommandClient(transport, fast);
    const res = await client.send({ kind: 'pattern', pattern });
    expect(res).toMatchObject({ ok: true, attempts: 2 });
    expect(writes[0]).toEqual(writes[1]); // identical bytes, same ID
    expect(firmware.appliedCount).toBe(1);
  });

  it('ignores acks for other command IDs or other command types', async () => {
    const { transport, deliver, writes } = loopback('never_ack');
    const client = new CommandClient(transport, { ...fast, maxAttempts: 1, ackTimeoutMs: 80 });
    const promise = client.send({ kind: 'reset' });
    await new Promise((r) => setTimeout(r, 10));
    expect(writes).toHaveLength(1);
    deliver(encodeAck(999, MessageType.Reset, AckStatus.Ok)); // stale ID
    deliver(encodeAck(1, MessageType.SetPattern, AckStatus.Ok)); // wrong type
    deliver(Uint8Array.of(1, 2, 3)); // garbage
    expect(await promise).toMatchObject({ ok: false, failure: 'timeout' });
  });

  it('accepts the right ack even when it arrives before the write promise resolves', async () => {
    const receivers = new Set<(b: Uint8Array) => void>();
    const transport: Transport = {
      maxWriteSize: 20,
      async write(bytes) {
        const id = bytes[0] | (bytes[1] << 8);
        receivers.forEach((r) => r(encodeAck(id, MessageType.Reset, AckStatus.Ok)));
      },
      onReceive(l) {
        receivers.add(l);
        return () => receivers.delete(l);
      },
    };
    const res = await new CommandClient(transport, fast).send({ kind: 'reset' });
    expect(res).toMatchObject({ ok: true, attempts: 1 });
  });

  it('stops immediately on a non-retryable rejection', async () => {
    const { transport, writes } = loopback('reject');
    const res = await new CommandClient(transport, fast).send({ kind: 'reset' });
    expect(res).toMatchObject({ ok: false, failure: 'rejected', status: AckStatus.HardwareFault, attempts: 1 });
    expect(writes).toHaveLength(1);
  });

  it('reports a dimension mismatch from the board', async () => {
    const { transport } = loopback();
    const res = await new CommandClient(transport, fast).send({ kind: 'pattern', pattern: createEmptyPattern(6, 8) });
    expect(res).toMatchObject({ ok: false, failure: 'rejected', status: AckStatus.DimensionMismatch });
  });

  it('retries after write errors, within the attempt limit', async () => {
    const { transport } = loopback();
    let failures = 2;
    const flaky: Transport = {
      ...transport,
      async write(b) {
        if (failures-- > 0) throw new Error('GATT error 133');
        return transport.write(b);
      },
    };
    expect(await new CommandClient(flaky, fast).send({ kind: 'reset' })).toMatchObject({ ok: true, attempts: 3 });

    failures = 10;
    expect(await new CommandClient(flaky, fast).send({ kind: 'reset' })).toMatchObject({
      ok: false,
      failure: 'write_failed',
      attempts: 3,
    });
  });

  it('rejects a second command while one is in flight', async () => {
    const { transport } = loopback();
    const client = new CommandClient(transport, fast);
    const first = client.send({ kind: 'pattern', pattern });
    const second = await client.send({ kind: 'reset' });
    expect(second).toMatchObject({ ok: false, failure: 'busy' });
    expect(await first).toMatchObject({ ok: true });
  });

  it('chunks across several writes when the pattern is larger than one write', async () => {
    const { transport, writes, firmware } = loopback('normal', 8);
    const res = await new CommandClient(transport, fast).send({ kind: 'pattern', pattern });
    expect(res.ok).toBe(true);
    expect(writes.length).toBe(Math.ceil(15 / 4)); // 15-byte message, 4 data bytes per 8-byte write
    expect(firmware.simulatedPins).toEqual(pattern);
  });

  it('uses incrementing command IDs that wrap and skip 0', async () => {
    const { transport } = loopback();
    const client = new CommandClient(transport, { ...fast, firstCommandId: 0xffff });
    expect(await client.send({ kind: 'reset' })).toMatchObject({ commandId: 0xffff });
    expect(await client.send({ kind: 'reset' })).toMatchObject({ commandId: 1 });
  });
});
