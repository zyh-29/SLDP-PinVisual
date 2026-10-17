/**
 * Splits one message into BLE writes that each fit the negotiated MTU.
 *
 * Chunk = [commandId lo][commandId hi][chunkIndex][chunkCount][data...]
 * The board reassembles chunks 0..count-1 in order, then decodes the message.
 */
export const CHUNK_HEADER_SIZE = 4;
export const MAX_CHUNKS = 255;
/** ATT header overhead per write. */
export const ATT_OVERHEAD = 3;
/** BLE default ATT MTU (23) -> 20-byte writes. */
export const DEFAULT_MTU = 23;
/** Largest attribute value BLE allows in one write. */
export const MAX_ATTRIBUTE_SIZE = 512;

export function maxWriteSizeForMtu(mtu: number): number {
  const usable = Math.max(DEFAULT_MTU, Math.floor(mtu)) - ATT_OVERHEAD;
  return Math.min(usable, MAX_ATTRIBUTE_SIZE);
}

export function chunkMessage(commandId: number, message: Uint8Array, maxWriteSize: number): Uint8Array[] {
  const dataPerChunk = maxWriteSize - CHUNK_HEADER_SIZE;
  if (dataPerChunk < 1) throw new Error(`Write size ${maxWriteSize} is too small for chunk header`);
  if (message.length === 0) throw new Error('Cannot send an empty message');
  const count = Math.ceil(message.length / dataPerChunk);
  if (count > MAX_CHUNKS) {
    throw new Error(`Message needs ${count} chunks; the protocol allows at most ${MAX_CHUNKS}`);
  }
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const data = message.subarray(i * dataPerChunk, (i + 1) * dataPerChunk);
    const chunk = new Uint8Array(CHUNK_HEADER_SIZE + data.length);
    chunk[0] = commandId & 0xff;
    chunk[1] = commandId >> 8;
    chunk[2] = i;
    chunk[3] = count;
    chunk.set(data, CHUNK_HEADER_SIZE);
    chunks.push(chunk);
  }
  return chunks;
}

export type ReassemblyEvent =
  | { type: 'incomplete' }
  | { type: 'complete'; commandId: number; message: Uint8Array }
  | { type: 'error'; reason: string };

/**
 * Reference reassembler (the firmware should behave the same way). Any chunk
 * that does not continue the current message restarts or discards it.
 */
export class ChunkReassembler {
  private commandId = -1;
  private expectedIndex = 0;
  private count = 0;
  private parts: Uint8Array[] = [];

  push(chunk: Uint8Array): ReassemblyEvent {
    if (chunk.length <= CHUNK_HEADER_SIZE) {
      this.clear();
      return { type: 'error', reason: 'Chunk too short' };
    }
    const id = chunk[0] | (chunk[1] << 8);
    const index = chunk[2];
    const count = chunk[3];
    if (count === 0 || index >= count) {
      this.clear();
      return { type: 'error', reason: `Bad chunk index ${index}/${count}` };
    }
    if (index === 0) {
      this.commandId = id;
      this.count = count;
      this.expectedIndex = 0;
      this.parts = [];
    } else if (id !== this.commandId || index !== this.expectedIndex || count !== this.count) {
      this.clear();
      return { type: 'error', reason: 'Out-of-order or stale chunk' };
    }
    this.parts.push(chunk.slice(CHUNK_HEADER_SIZE));
    this.expectedIndex = index + 1;
    if (this.expectedIndex < this.count) return { type: 'incomplete' };

    const total = this.parts.reduce((n, p) => n + p.length, 0);
    const message = new Uint8Array(total);
    let offset = 0;
    for (const p of this.parts) {
      message.set(p, offset);
      offset += p.length;
    }
    const commandId = this.commandId;
    this.clear();
    return { type: 'complete', commandId, message };
  }

  clear() {
    this.commandId = -1;
    this.expectedIndex = 0;
    this.count = 0;
    this.parts = [];
  }
}
