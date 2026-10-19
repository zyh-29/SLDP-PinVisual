/**
 * Application-level messages exchanged with the ESP32. Byte layouts are
 * specified in docs/PROTOCOL.md; keep the two in sync.
 *
 * Message = header(6) + payload(N) + crc16(2), all multi-byte fields little-endian.
 *   [0] protocol version
 *   [1] message type
 *   [2..3] command ID (u16, 1..65535; 0 is reserved)
 *   [4..5] payload length N (u16)
 *   [6..6+N-1] payload
 *   [6+N..7+N] CRC-16/CCITT-FALSE over bytes [0 .. 6+N-1]
 */
import { PROTOCOL } from '@/config/hardware';
import { isValidDimension, packPins, type Pattern, validatePattern } from '@/domain/pattern';
import { crc16 } from './crc16';

export const MessageType = {
  SetPattern: 0x01,
  Reset: 0x02,
  /** Board -> app response to a command. */
  Ack: 0x80,
} as const;
export type MessageTypeCode = (typeof MessageType)[keyof typeof MessageType];

/** Status byte inside an Ack. 0 means the board accepted the command. */
export const AckStatus = {
  Ok: 0x00,
  CrcMismatch: 0x01,
  UnsupportedVersion: 0x02,
  UnknownType: 0x03,
  BadLength: 0x04,
  DimensionMismatch: 0x05,
  Busy: 0x06,
  HardwareFault: 0x07,
} as const;
export type AckStatusCode = (typeof AckStatus)[keyof typeof AckStatus];

export const ACK_STATUS_TEXT: Record<number, string> = {
  [AckStatus.Ok]: 'OK',
  [AckStatus.CrcMismatch]: 'Board reported corrupted data (CRC mismatch)',
  [AckStatus.UnsupportedVersion]: 'Board does not support this protocol version',
  [AckStatus.UnknownType]: 'Board did not recognise the command',
  [AckStatus.BadLength]: 'Board reported a malformed message',
  [AckStatus.DimensionMismatch]: 'Board grid size does not match the app grid size',
  [AckStatus.Busy]: 'Board was busy',
  [AckStatus.HardwareFault]: 'Board reported a hardware fault',
};

/** Statuses where resending the same command may succeed. */
export function isRetryableStatus(status: number): boolean {
  return status === AckStatus.CrcMismatch || status === AckStatus.Busy;
}

export const HEADER_SIZE = 6;
export const CRC_SIZE = 2;
export const MAX_COMMAND_ID = 0xffff;

export type Command =
  | { kind: 'pattern'; pattern: Pattern }
  | { kind: 'reset' };

function assertCommandId(id: number) {
  if (!Number.isInteger(id) || id < 1 || id > MAX_COMMAND_ID) {
    throw new Error(`Command ID must be 1..${MAX_COMMAND_ID}, got ${id}`);
  }
}

function frame(type: number, commandId: number, payload: Uint8Array, version: number = PROTOCOL.version): Uint8Array {
  assertCommandId(commandId);
  const out = new Uint8Array(HEADER_SIZE + payload.length + CRC_SIZE);
  out[0] = version;
  out[1] = type;
  out[2] = commandId & 0xff;
  out[3] = commandId >> 8;
  out[4] = payload.length & 0xff;
  out[5] = payload.length >> 8;
  out.set(payload, HEADER_SIZE);
  const crc = crc16(out, 0, HEADER_SIZE + payload.length);
  out[HEADER_SIZE + payload.length] = crc & 0xff;
  out[HEADER_SIZE + payload.length + 1] = crc >> 8;
  return out;
}

/** SET_PATTERN payload: rows(u8) cols(u8) bitmap(ceil(rows*cols/8)). */
export function encodeSetPattern(commandId: number, pattern: Pattern): Uint8Array {
  const err = validatePattern(pattern);
  if (err) throw new Error(err);
  const bits = packPins(pattern);
  const payload = new Uint8Array(2 + bits.length);
  payload[0] = pattern.rows;
  payload[1] = pattern.cols;
  payload.set(bits, 2);
  return frame(MessageType.SetPattern, commandId, payload);
}

/** RESET has no payload: the board lowers every pin. */
export function encodeReset(commandId: number): Uint8Array {
  return frame(MessageType.Reset, commandId, new Uint8Array(0));
}

export function encodeCommand(commandId: number, command: Command): Uint8Array {
  return command.kind === 'pattern'
    ? encodeSetPattern(commandId, command.pattern)
    : encodeReset(commandId);
}

/** ACK payload: acknowledged type(u8) status(u8). Used by the firmware (and the test firmware model). */
export function encodeAck(commandId: number, ackedType: number, status: number): Uint8Array {
  return frame(MessageType.Ack, commandId, Uint8Array.of(ackedType, status));
}

export interface DecodedMessage {
  version: number;
  type: number;
  commandId: number;
  payload: Uint8Array;
}

export type DecodeResult = { ok: true; message: DecodedMessage } | { ok: false; error: string; status: AckStatusCode };

/** Validates framing, version, length and CRC of a complete message. */
export function decodeMessage(bytes: Uint8Array): DecodeResult {
  if (bytes.length < HEADER_SIZE + CRC_SIZE) {
    return { ok: false, error: `Message too short (${bytes.length} bytes)`, status: AckStatus.BadLength };
  }
  const payloadLength = bytes[4] | (bytes[5] << 8);
  if (bytes.length !== HEADER_SIZE + payloadLength + CRC_SIZE) {
    return {
      ok: false,
      error: `Length field says ${payloadLength} payload bytes but message has ${bytes.length - HEADER_SIZE - CRC_SIZE}`,
      status: AckStatus.BadLength,
    };
  }
  const expected = crc16(bytes, 0, HEADER_SIZE + payloadLength);
  const actual = bytes[HEADER_SIZE + payloadLength] | (bytes[HEADER_SIZE + payloadLength + 1] << 8);
  if (expected !== actual) {
    return { ok: false, error: 'CRC mismatch', status: AckStatus.CrcMismatch };
  }
  if (bytes[0] !== PROTOCOL.version) {
    return { ok: false, error: `Unsupported protocol version ${bytes[0]}`, status: AckStatus.UnsupportedVersion };
  }
  const commandId = bytes[2] | (bytes[3] << 8);
  if (commandId === 0) {
    return { ok: false, error: 'Command ID 0 is reserved', status: AckStatus.BadLength };
  }
  return {
    ok: true,
    message: {
      version: bytes[0],
      type: bytes[1],
      commandId,
      payload: bytes.slice(HEADER_SIZE, HEADER_SIZE + payloadLength),
    },
  };
}

export interface Ack {
  commandId: number;
  ackedType: number;
  status: number;
}

/** Parses a board -> app acknowledgement. Returns null for anything malformed. */
export function decodeAck(bytes: Uint8Array): Ack | null {
  const res = decodeMessage(bytes);
  if (!res.ok) return null;
  const { message } = res;
  if (message.type !== MessageType.Ack || message.payload.length !== 2) return null;
  return { commandId: message.commandId, ackedType: message.payload[0], status: message.payload[1] };
}

/** Validates a SET_PATTERN payload against the board's grid (used by the firmware and the test firmware model). */
export function validateSetPatternPayload(
  payload: Uint8Array,
  boardRows: number,
  boardCols: number,
): { ok: true; rows: number; cols: number; bits: Uint8Array } | { ok: false; status: AckStatusCode } {
  if (payload.length < 2) return { ok: false, status: AckStatus.BadLength };
  const rows = payload[0];
  const cols = payload[1];
  if (!isValidDimension(rows, cols)) return { ok: false, status: AckStatus.BadLength };
  if (payload.length !== 2 + Math.ceil((rows * cols) / 8)) return { ok: false, status: AckStatus.BadLength };
  if (rows !== boardRows || cols !== boardCols) return { ok: false, status: AckStatus.DimensionMismatch };
  return { ok: true, rows, cols, bits: payload.slice(2) };
}
