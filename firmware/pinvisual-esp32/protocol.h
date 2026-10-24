// PinVisual BLE protocol v1, board side (see docs/PROTOCOL.md).
//
// Plain C++ with no Arduino or ESP32 code, so it is unit tested on a computer
// (firmware/test/protocol_test.cpp). The sketch feeds it each BLE write and
// sends back the acknowledgement it produces.
//
// It behaves like the app's own model of the board
// (src/device/__tests__/support/MockFirmware.ts):
//   - chunks are reassembled in order; anything out of order is dropped;
//   - messages are checked (length, CRC, version, command ID);
//   - a retried command (same ID and type as the last one) gets the same
//     acknowledgement again, and the servos are not moved twice.
#pragma once

#include <stddef.h>
#include <stdint.h>

namespace pinvisual {

constexpr uint8_t kProtocolVersion = 1;

// Message types.
constexpr uint8_t kSetPattern = 0x01;
constexpr uint8_t kReset = 0x02;
constexpr uint8_t kAck = 0x80;

// Acknowledgement status codes.
constexpr uint8_t kOk = 0x00;
constexpr uint8_t kCrcMismatch = 0x01;
constexpr uint8_t kUnsupportedVersion = 0x02;
constexpr uint8_t kUnknownType = 0x03;
constexpr uint8_t kBadLength = 0x04;
constexpr uint8_t kDimensionMismatch = 0x05;
constexpr uint8_t kBusy = 0x06;
constexpr uint8_t kHardwareFault = 0x07;

constexpr size_t kHeaderSize = 6;  // version, type, commandId (2), payloadLength (2)
constexpr size_t kCrcSize = 2;
constexpr size_t kChunkHeaderSize = 4;  // commandId (2), chunkIndex, chunkCount
constexpr size_t kAckSize = 10;
// The protocol allows grids up to 64 x 64 (one byte each for rows and cols).
constexpr uint8_t kMaxSide = 64;
constexpr size_t kMaxMessage = kHeaderSize + 2 + (kMaxSide * kMaxSide + 7) / 8 + kCrcSize;
// A message whose next chunk takes longer than this is dropped (section 4, rule 4).
constexpr uint32_t kChunkTimeoutMs = 2000;

// CRC-16/CCITT-FALSE: polynomial 0x1021, init 0xFFFF, no reflection, no final XOR.
uint16_t crc16(const uint8_t* data, size_t length);

// The 10-byte ACK message for `commandId`.
void encodeAck(uint16_t commandId, uint8_t ackedType, uint8_t status, uint8_t out[kAckSize]);

// Pin `index` of a SET_PATTERN bitmap: bit index % 8 of byte index / 8.
inline bool pinRaised(const uint8_t* bitmap, int index) { return (bitmap[index >> 3] >> (index & 7)) & 1; }

// What moves the pins (the servo boards, or a fake in tests).
class PinOutput {
 public:
  virtual ~PinOutput() = default;
  // Raise or lower every pin as the bitmap says. False when the hardware failed (a PCA9685 not answering).
  virtual bool show(const uint8_t* bitmap, uint8_t rows, uint8_t cols) = 0;
  // Lower every pin.
  virtual bool lowerAll() = 0;
};

class Board {
 public:
  Board(uint8_t rows, uint8_t cols, PinOutput& out);

  // One BLE write to the command characteristic. Returns true when an acknowledgement should be sent
  // (written to `ack`), false when there is nothing to answer yet (more chunks to come) or nothing to answer at all
  // (a broken chunk; the app retries).
  bool receive(const uint8_t* chunk, size_t length, uint32_t nowMs, uint8_t ack[kAckSize]);

  // Commands that moved the pins (retries don't count). For tests and the serial log.
  uint32_t applied() const { return applied_; }

 private:
  bool handle(uint16_t chunkCommandId, uint8_t ack[kAckSize]);
  void dropPartial();

  const uint8_t rows_;
  const uint8_t cols_;
  PinOutput& out_;

  // The message being reassembled.
  uint8_t buffer_[kMaxMessage];
  size_t used_ = 0;
  bool active_ = false;
  uint16_t partialId_ = 0;
  uint8_t partialCount_ = 0;
  uint8_t nextIndex_ = 0;
  uint32_t lastChunkAt_ = 0;

  // The last command handled, for answering retries without moving the servos again.
  bool haveLast_ = false;
  uint16_t lastId_ = 0;
  uint8_t lastType_ = 0;
  uint8_t lastStatus_ = 0;

  uint32_t applied_ = 0;
};

}  // namespace pinvisual
