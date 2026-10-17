/**
 * CRC-16/CCITT-FALSE: poly 0x1021, init 0xFFFF, no reflection, no final XOR.
 * Check value: crc16("123456789") === 0x29B1.
 */
export function crc16(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let crc = 0xffff;
  for (let i = start; i < end; i++) {
    crc ^= bytes[i] << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}
