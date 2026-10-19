# PinVisual BLE Protocol v1 (proposed)

This is what the ESP32 firmware must implement to work with the app. It is a
**proposal**: the app and its test firmware model implement it, but no real
firmware has been tested against it yet.

Source of truth in the app: `src/protocol/messages.ts`, `src/protocol/chunking.ts`,
`src/protocol/crc16.ts`. The test firmware model in
`src/device/__tests__/support/MockFirmware.ts` is a working reference implementation of
the firmware side (in TypeScript), used by the automated tests only.

---

## 1. GATT layout

| Item | UUID (PLACEHOLDER) | Properties | Direction |
|---|---|---|---|
| Service | `7a1e0001-3c4b-4f2a-9b8e-5d6c7b8a9f01` | primary | — |
| Command characteristic | `7a1e0002-3c4b-4f2a-9b8e-5d6c7b8a9f01` | **Write With Response** | app → board |
| Ack characteristic | `7a1e0003-3c4b-4f2a-9b8e-5d6c7b8a9f01` | **Notify** | board → app |

- These UUIDs are placeholders generated for the app. When the firmware picks
  its own, update `BLE` in `src/config/hardware.ts` and set
  `uuidsArePlaceholders: false`.
- Advertise a name starting with **`PinVisual`** (e.g. `PinVisual-01`) and, if
  space allows, the service UUID. The app lists such devices first.
- Accept an MTU request up to 185 (Android asks for 185; iOS negotiates itself).
  The protocol still works at the default MTU of 23.

## 2. Pin order (must match exactly)

Looking **at the display from the user's side**:

- Row 0 is the **top** row, column 0 is the **leftmost** column.
- Pins are numbered **row-major**: `index = row * cols + col`.
- For the provisional 5 × 8 grid:

```
        col0 col1 col2 col3 col4 col5 col6 col7
row 0     0    1    2    3    4    5    6    7
row 1     8    9   10   11   12   13   14   15
row 2    16   17   18   19   20   21   22   23
row 3    24   25   26   27   28   29   30   31
row 4    32   33   34   35   36   37   38   39
```

- Value **1 = raised**, **0 = lowered**.

**Suggested** servo wiring (the app does not depend on it; change freely in
firmware): pin `i` → PCA9685 board `i / 16`, channel `i % 16`, I²C address
`0x40 + board`. For 40 pins: boards 0x40 (pins 0–15), 0x41 (16–31), 0x42 (32–39).

## 3. Message format

All multi-byte fields are **little-endian**.

```
offset  size  field
0       1     version         = 0x01
1       1     type            (see below)
2       2     commandId       u16, 1..65535 (0 is reserved, never sent)
4       2     payloadLength   N, u16
6       N     payload
6+N     2     crc16           CRC-16/CCITT-FALSE over bytes [0 .. 6+N-1]
```

CRC-16/CCITT-FALSE: polynomial `0x1021`, init `0xFFFF`, no reflection, no final
XOR. Check value: CRC of ASCII `"123456789"` = `0x29B1`.

### Message types

| Type | Name | Direction | Payload |
|---|---|---|---|
| `0x01` | SET_PATTERN | app → board | `rows` (u8), `cols` (u8), bitmap (`ceil(rows*cols/8)` bytes) |
| `0x02` | RESET | app → board | none (N = 0). Lower every pin. |
| `0x80` | ACK | board → app | `ackedType` (u8), `status` (u8) |

**Bitmap**: pin `i` is bit `i % 8` (LSB = bit 0) of byte `i / 8`. Unused bits in
the last byte are 0. For 5 × 8 the bitmap is 5 bytes; byte `r` is row `r`, with
bit `c` = column `c`.

### ACK status codes

| Code | Meaning | App behaviour |
|---|---|---|
| `0x00` | OK — command accepted | success |
| `0x01` | CRC mismatch | retries |
| `0x02` | Unsupported protocol version | fails |
| `0x03` | Unknown message type | fails |
| `0x04` | Bad length / malformed | fails |
| `0x05` | rows/cols don't match the board | fails |
| `0x06` | Busy | retries |
| `0x07` | Hardware fault (e.g. PCA9685 not responding on I²C) | fails |

## 4. Chunking (BLE write size)

A message is never assumed to fit one write. The app splits each message into
chunks that fit `MTU − 3` bytes:

```
offset  size  field
0       2     commandId (u16, same as in the message)
2       1     chunkIndex (0-based)
3       1     chunkCount (1..255)
4       ...   next slice of the message bytes
```

At the default MTU (20-byte writes) each chunk carries 16 message bytes. The
40-pin SET_PATTERN message is 15 bytes, so it is one chunk today, but larger
grids span several.

Firmware reassembly rules:

1. `chunkIndex == 0` starts a new message (discard any partial one).
2. Otherwise, the chunk must have the same `commandId` and `chunkCount` and
   `chunkIndex == previous + 1`; if not, discard the partial message (no ACK).
3. After the last chunk, decode and validate the message (section 3).
4. Optional: discard a partial message if the next chunk takes more than ~2 s.

## 5. Acknowledgement rules

- Send exactly one ACK notification per complete, decodable message.
  The ACK is a normal message (type `0x80`) with the **same commandId** and the
  type being acknowledged. It is 10 bytes, so it fits a single notification.
- Send `status = OK` **after** validating the message and issuing the servo
  commands to the PCA9685 boards. Do not wait for the servos to finish moving
  unless you want the app to wait too (keep it under the 3 s timeout).
- If the CRC fails, you may reply with status `0x01` using the commandId from
  the header, or stay silent. The app retries either way.
- **De-duplication (required):** the app retries with the **same commandId and
  identical bytes** when it doesn't get an ACK in time. Remember the last
  applied `(commandId, type, status)`. If the same commandId and type arrive
  again, re-send the same ACK **without** moving servos again.

The app's wording after an OK ACK is "Board received pattern". The app never
claims that pins were physically verified, because there is no position sensing.

## 6. App timing

| Setting | Value | Where |
|---|---|---|
| ACK timeout (after the last chunk is written) | 3000 ms | `PROTOCOL.ackTimeoutMs` |
| Attempts per command | 3 (1 + 2 retries) | `PROTOCOL.maxAttempts` |
| Delay between attempts | 400 ms | `PROTOCOL.retryDelayMs` |

Only one command is in flight at a time. The app blocks Send and Reset while a
command is pending.

## 7. Test vectors

Generated by `src/protocol/__tests__/protocol.test.ts` (snapshot) and
cross-checked with Python's `binascii.crc_hqx(data, 0xFFFF)`.

SET_PATTERN, commandId 1, 5 × 8 grid, pin 0 (row 0, col 0) and pin 39
(row 4, col 7) raised:

```
01 01 01 00 07 00 05 08 01 00 00 00 80 c4 48
^v ^t ^id-- ^len- ^r ^c ^------bitmap- ^crc-
```

As one BLE chunk (commandId 1, chunk 0 of 1):

```
01 00 00 01 | 01 01 01 00 07 00 05 08 01 00 00 00 80 c4 48
```

RESET, commandId 2: `01 02 02 00 00 00 5b e2`

ACK OK for commandId 1 / SET_PATTERN: `01 80 01 00 02 00 01 00 ed 46`

ACK OK for commandId 2 / RESET: `01 80 02 00 02 00 02 00 5e dd`

## 8. Firmware reference (C, untested sketch)

```c
uint16_t crc16_ccitt_false(const uint8_t *d, size_t n) {
  uint16_t crc = 0xFFFF;
  for (size_t i = 0; i < n; i++) {
    crc ^= (uint16_t)d[i] << 8;
    for (int b = 0; b < 8; b++)
      crc = (crc & 0x8000) ? (uint16_t)((crc << 1) ^ 0x1021) : (uint16_t)(crc << 1);
  }
  return crc;
}

bool pin_raised(const uint8_t *bitmap, int index) {
  return (bitmap[index >> 3] >> (index & 7)) & 1;
}

// After a complete, CRC-valid SET_PATTERN for this board's rows x cols:
//   for (int i = 0; i < rows * cols; i++)
//     set_servo(i / 16, i % 16, pin_raised(bitmap, i) ? RAISED_PULSE : LOWERED_PULSE);
//   send_ack(commandId, 0x01, 0x00);
```

## 9. Open questions for the hardware team

- Real UUIDs and the advertised name.
- Final grid size and pin pitch (update `GRID` in `src/config/hardware.ts`).
- Should the ACK wait until servos finish moving? (If so, keep it under 3 s or
  raise `ackTimeoutMs`.)
- Power budget: moving 40 servos at once may brown out the supply. Firmware may
  need to stagger moves, which affects ACK timing.
- Should the board lower all pins on disconnect or power-up?
