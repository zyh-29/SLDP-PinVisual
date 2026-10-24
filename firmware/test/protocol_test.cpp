// Tests for the board's protocol code, run on a computer (no ESP32 needed):
//   npm run test:firmware
// The byte strings are the test vectors in docs/PROTOCOL.md (made by the app's own encoder).
#include <stdio.h>
#include <string.h>

#include <string>
#include <vector>

#include "../pinvisual-esp32/protocol.h"

using namespace pinvisual;
using Bytes = std::vector<uint8_t>;

static int failures = 0;
#define CHECK(cond)                                                    \
  do {                                                                 \
    if (!(cond)) {                                                     \
      printf("  FAILED line %d: %s\n", __LINE__, #cond);               \
      failures++;                                                      \
    }                                                                  \
  } while (0)

static Bytes hex(const char* s) {
  Bytes out;
  unsigned v;
  int n;
  while (sscanf(s, " %2x%n", &v, &n) == 1) {
    out.push_back(static_cast<uint8_t>(v));
    s += n;
  }
  return out;
}

static std::string toHex(const uint8_t* b, size_t n) {
  std::string s;
  char t[4];
  for (size_t i = 0; i < n; i++) {
    snprintf(t, sizeof t, i ? " %02x" : "%02x", b[i]);
    s += t;
  }
  return s;
}

// A message as the app builds it (src/protocol/messages.ts).
static Bytes message(uint8_t type, uint16_t id, const Bytes& payload, uint8_t version = 1) {
  Bytes m = {version, type, static_cast<uint8_t>(id & 0xFF), static_cast<uint8_t>(id >> 8), static_cast<uint8_t>(payload.size() & 0xFF),
             static_cast<uint8_t>(payload.size() >> 8)};
  m.insert(m.end(), payload.begin(), payload.end());
  const uint16_t crc = crc16(m.data(), m.size());
  m.push_back(crc & 0xFF);
  m.push_back(crc >> 8);
  return m;
}

// Chunks as the app sends them (src/protocol/chunking.ts), `write` bytes per BLE write.
static std::vector<Bytes> chunks(uint16_t id, const Bytes& m, size_t write = 20) {
  const size_t per = write - kChunkHeaderSize;
  const size_t count = (m.size() + per - 1) / per;
  std::vector<Bytes> out;
  for (size_t i = 0; i < count; i++) {
    Bytes c = {static_cast<uint8_t>(id & 0xFF), static_cast<uint8_t>(id >> 8), static_cast<uint8_t>(i), static_cast<uint8_t>(count)};
    c.insert(c.end(), m.begin() + i * per, m.begin() + std::min(m.size(), (i + 1) * per));
    out.push_back(c);
  }
  return out;
}

static Bytes pattern(uint8_t rows, uint8_t cols, std::vector<int> raised) {
  Bytes p = {rows, cols};
  p.resize(2 + (rows * cols + 7) / 8, 0);
  for (int i : raised) p[2 + i / 8] |= 1 << (i % 8);
  return p;
}

// A fake set of servo boards.
struct FakeServos : PinOutput {
  std::vector<bool> pins;
  int moves = 0;
  bool broken = false;
  bool show(const uint8_t* bitmap, uint8_t rows, uint8_t cols) override {
    if (broken) return false;
    pins.assign(rows * cols, false);
    for (int i = 0; i < rows * cols; i++) pins[i] = pinRaised(bitmap, i);
    moves++;
    return true;
  }
  bool lowerAll() override {
    if (broken) return false;
    pins.assign(pins.size(), false);
    moves++;
    return true;
  }
};

// Sends every chunk; returns the acknowledgement (empty when there was none).
static std::string send(Board& b, const std::vector<Bytes>& cs, uint32_t now = 0) {
  uint8_t ack[kAckSize];
  std::string got;
  for (const Bytes& c : cs)
    if (b.receive(c.data(), c.size(), now, ack)) got = toHex(ack, kAckSize);
  return got;
}

static void test(const char* name, void (*fn)()) {
  const int before = failures;
  fn();
  printf("%s %s\n", failures == before ? "ok  " : "FAIL", name);
}

int main() {
  test("CRC-16/CCITT-FALSE check value", [] {
    const char* s = "123456789";
    CHECK(crc16(reinterpret_cast<const uint8_t*>(s), 9) == 0x29B1);
  });

  test("doc vector: SET_PATTERN 5x6, pins 0 and 29, as one chunk", [] {
    FakeServos out;
    Board b(5, 6, out);
    const Bytes chunk = hex("01 00 00 01 01 01 01 00 06 00 05 06 01 00 00 20 19 6c");
    CHECK(send(b, {chunk}) == "01 80 01 00 02 00 01 00 ed 46");
    CHECK(out.pins.size() == 30 && out.pins[0] && out.pins[29]);
    int up = 0;
    for (bool p : out.pins) up += p;
    CHECK(up == 2);
  });

  test("doc vector: RESET lowers every pin", [] {
    FakeServos out;
    Board b(5, 6, out);
    send(b, chunks(1, message(kSetPattern, 1, pattern(5, 6, {3, 4, 5}))));
    const Bytes reset = hex("01 02 02 00 00 00 5b e2");
    CHECK(reset == message(kReset, 2, {}));
    CHECK(send(b, chunks(2, reset)) == "01 80 02 00 02 00 02 00 5e dd");
    for (bool p : out.pins) CHECK(!p);
  });

  test("a retry gets the same answer and the servos don't move again", [] {
    FakeServos out;
    Board b(5, 6, out);
    const auto cs = chunks(7, message(kSetPattern, 7, pattern(5, 6, {1})));
    const std::string first = send(b, cs);
    const std::string again = send(b, cs);
    CHECK(!first.empty() && first == again);
    CHECK(out.moves == 1 && b.applied() == 1);
  });

  test("a big grid in several chunks (default 20-byte writes)", [] {
    FakeServos out;
    Board b(10, 10, out);
    const auto cs = chunks(9, message(kSetPattern, 9, pattern(10, 10, {0, 55, 99})));
    CHECK(cs.size() == 2);
    uint8_t ack[kAckSize];
    CHECK(!b.receive(cs[0].data(), cs[0].size(), 0, ack));  // nothing to say until the last chunk
    CHECK(b.receive(cs[1].data(), cs[1].size(), 10, ack));
    CHECK(ack[7] == kOk && out.pins[0] && out.pins[55] && out.pins[99] && !out.pins[1]);
  });

  test("a 64x64 grid at the default write size (many chunks)", [] {
    FakeServos out;
    Board b(64, 64, out);
    const auto cs = chunks(3, message(kSetPattern, 3, pattern(64, 64, {0, 4095})));
    CHECK(cs.size() > 30);
    CHECK(send(b, cs).substr(21, 2) == "00");
    CHECK(out.pins[0] && out.pins[4095]);
  });

  test("out-of-order chunk: dropped, no answer; a fresh retry from chunk 0 works", [] {
    FakeServos out;
    Board b(10, 10, out);
    const auto cs = chunks(4, message(kSetPattern, 4, pattern(10, 10, {5})));
    CHECK(send(b, {cs[1]}).empty());
    CHECK(send(b, cs).substr(21, 2) == "00");
  });

  test("a chunk arriving more than 2 s late: the message is dropped", [] {
    FakeServos out;
    Board b(10, 10, out);
    const auto cs = chunks(5, message(kSetPattern, 5, pattern(10, 10, {5})));
    uint8_t ack[kAckSize];
    b.receive(cs[0].data(), cs[0].size(), 1000, ack);
    CHECK(!b.receive(cs[1].data(), cs[1].size(), 3500, ack));
    CHECK(out.moves == 0);
  });

  test("errors: bad CRC, wrong grid, wrong version, unknown type, bad length, broken servo board", [] {
    FakeServos out;
    Board b(5, 6, out);
    Bytes m = message(kSetPattern, 10, pattern(5, 6, {0}));
    m[8] ^= 0xFF;  // damage the bitmap
    uint8_t crcAck[kAckSize];
    encodeAck(10, kSetPattern, kCrcMismatch, crcAck);
    CHECK(send(b, chunks(10, m)) == toHex(crcAck, kAckSize));
    CHECK(toHex(crcAck, 8) == "01 80 0a 00 02 00 01 01");
    auto status = [&](const Bytes& msg, uint16_t id) {
      const std::string a = send(b, chunks(id, msg));
      return a.empty() ? std::string("none") : a.substr(21, 2);
    };
    CHECK(status(message(kSetPattern, 11, pattern(5, 8, {0})), 11) == "05");
    CHECK(status(message(kSetPattern, 12, pattern(5, 6, {0}), 2), 12) == "02");
    CHECK(status(message(0x09, 13, {}), 13) == "03");
    CHECK(status(message(kReset, 14, {1}), 14) == "04");
    CHECK(status(message(kSetPattern, 15, {5, 6, 0}), 15) == "04");
    out.broken = true;
    CHECK(status(message(kSetPattern, 16, pattern(5, 6, {0})), 16) == "07");
    CHECK(out.moves == 0);
  });

  test("broken chunks are ignored: too short, count 0, index past count", [] {
    FakeServos out;
    Board b(5, 6, out);
    CHECK(send(b, {hex("01 00 00 01")}).empty());
    CHECK(send(b, {hex("01 00 00 00 01")}).empty());
    CHECK(send(b, {hex("01 00 02 02 01")}).empty());
  });

  printf(failures ? "\n%d check(s) failed\n" : "\nAll firmware protocol tests passed\n", failures);
  return failures ? 1 : 0;
}
