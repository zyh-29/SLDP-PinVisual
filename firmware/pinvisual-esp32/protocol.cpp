#include "protocol.h"

#include <string.h>

namespace pinvisual {

uint16_t crc16(const uint8_t* data, size_t length) {
  uint16_t crc = 0xFFFF;
  for (size_t i = 0; i < length; i++) {
    crc ^= static_cast<uint16_t>(data[i]) << 8;
    for (int b = 0; b < 8; b++) crc = (crc & 0x8000) ? static_cast<uint16_t>((crc << 1) ^ 0x1021) : static_cast<uint16_t>(crc << 1);
  }
  return crc;
}

void encodeAck(uint16_t commandId, uint8_t ackedType, uint8_t status, uint8_t out[kAckSize]) {
  out[0] = kProtocolVersion;
  out[1] = kAck;
  out[2] = commandId & 0xFF;
  out[3] = commandId >> 8;
  out[4] = 2;  // payload length, little-endian
  out[5] = 0;
  out[6] = ackedType;
  out[7] = status;
  const uint16_t crc = crc16(out, 8);
  out[8] = crc & 0xFF;
  out[9] = crc >> 8;
}

Board::Board(uint8_t rows, uint8_t cols, PinOutput& out) : rows_(rows), cols_(cols), out_(out) {}

void Board::dropPartial() {
  active_ = false;
  used_ = 0;
  nextIndex_ = 0;
}

bool Board::receive(const uint8_t* chunk, size_t length, uint32_t nowMs, uint8_t ack[kAckSize]) {
  // A chunk carries at least one byte of the message.
  if (length <= kChunkHeaderSize) {
    dropPartial();
    return false;
  }
  const uint16_t id = chunk[0] | (chunk[1] << 8);
  const uint8_t index = chunk[2];
  const uint8_t count = chunk[3];
  if (count == 0 || index >= count) {
    dropPartial();
    return false;
  }
  // A message whose next chunk is late is given up.
  if (active_ && nowMs - lastChunkAt_ > kChunkTimeoutMs) dropPartial();

  if (index == 0) {
    // Chunk 0 always starts a new message (any partial one is dropped).
    active_ = true;
    partialId_ = id;
    partialCount_ = count;
    used_ = 0;
  } else if (!active_ || id != partialId_ || count != partialCount_ || index != nextIndex_) {
    // Out of order or from another message: drop it all, no acknowledgement (the app retries).
    dropPartial();
    return false;
  }

  const size_t data = length - kChunkHeaderSize;
  if (used_ + data > kMaxMessage) {
    dropPartial();
    return false;
  }
  memcpy(buffer_ + used_, chunk + kChunkHeaderSize, data);
  used_ += data;
  nextIndex_ = index + 1;
  lastChunkAt_ = nowMs;
  if (nextIndex_ < partialCount_) return false;

  active_ = false;
  return handle(id, ack);
}

bool Board::handle(uint16_t chunkCommandId, uint8_t ack[kAckSize]) {
  const uint8_t* m = buffer_;
  const size_t n = used_;
  used_ = 0;
  nextIndex_ = 0;

  // Framing errors are answered with the command ID from the chunks and the type byte, when there is one.
  auto fail = [&](uint8_t status) {
    if (chunkCommandId == 0) return false;
    encodeAck(chunkCommandId, n > 1 ? m[1] : 0, status, ack);
    return true;
  };

  // Same order of checks as the app's decodeMessage (src/protocol/messages.ts).
  if (n < kHeaderSize + kCrcSize) return fail(kBadLength);
  const size_t payloadLength = m[4] | (m[5] << 8);
  if (n != kHeaderSize + payloadLength + kCrcSize) return fail(kBadLength);
  const uint16_t expected = crc16(m, kHeaderSize + payloadLength);
  const uint16_t actual = m[kHeaderSize + payloadLength] | (m[kHeaderSize + payloadLength + 1] << 8);
  if (expected != actual) return fail(kCrcMismatch);
  if (m[0] != kProtocolVersion) return fail(kUnsupportedVersion);
  const uint16_t commandId = m[2] | (m[3] << 8);
  if (commandId == 0) return fail(kBadLength);  // reserved: the app never sends it

  const uint8_t type = m[1];
  const uint8_t* payload = m + kHeaderSize;

  // A retry of the command just handled: the same answer, and the servos stay put.
  if (haveLast_ && lastId_ == commandId && lastType_ == type) {
    encodeAck(commandId, type, lastStatus_, ack);
    return true;
  }

  uint8_t status;
  if (type == kSetPattern) {
    if (payloadLength < 2) {
      status = kBadLength;
    } else {
      const uint8_t rows = payload[0];
      const uint8_t cols = payload[1];
      if (rows < 1 || cols < 1 || rows > kMaxSide || cols > kMaxSide || payloadLength != 2 + (rows * cols + 7) / 8) {
        status = kBadLength;
      } else if (rows != rows_ || cols != cols_) {
        status = kDimensionMismatch;
      } else if (!out_.show(payload + 2, rows, cols)) {
        status = kHardwareFault;
      } else {
        applied_++;
        status = kOk;
      }
    }
  } else if (type == kReset) {
    if (payloadLength != 0) {
      status = kBadLength;
    } else if (!out_.lowerAll()) {
      status = kHardwareFault;
    } else {
      applied_++;
      status = kOk;
    }
  } else {
    status = kUnknownType;
  }

  haveLast_ = true;
  lastId_ = commandId;
  lastType_ = type;
  lastStatus_ = status;
  encodeAck(commandId, type, status, ack);
  return true;
}

}  // namespace pinvisual
