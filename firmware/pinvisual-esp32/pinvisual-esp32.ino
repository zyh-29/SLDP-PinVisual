#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// ---- Must match the app (src/config/hardware.ts) ----
#define DEVICE_NAME  "PinVisual-01"
#define SERVICE_UUID "7a1e0001-3c4b-4f2a-9b8e-5d6c7b8a9f01"
#define COMMAND_UUID "7a1e0002-3c4b-4f2a-9b8e-5d6c7b8a9f01"
#define ACK_UUID     "7a1e0003-3c4b-4f2a-9b8e-5d6c7b8a9f01"
constexpr int ROWS = 5;
constexpr int COLS = 6;

// ---- Servo ----
constexpr int SERVO_PIN = 18;    // D18
constexpr int CONTROL_PIN = 0;   // grid pin that raises/lowers this servo (0 = top-left)
// Continuous-rotation servo: 1500 us = stop, further from 1500 = faster.
constexpr int RAISE_US = 2000;   // direction for raising. If the pin goes DOWN when raised, swap these two.
constexpr int LOWER_US = 1000;   // direction for lowering
// How long to turn. Set these so the servo makes the turns your mechanism needs (2-3).
// Measure with the Serial Monitor: type "u" and "d" and count the turns, then adjust.
unsigned long RAISE_MS = 1500;
unsigned long LOWER_MS = 1500;

// ---- Protocol constants (docs/PROTOCOL.md) ----
constexpr uint8_t TYPE_SET_PATTERN = 0x01;
constexpr uint8_t TYPE_RESET = 0x02;
constexpr uint8_t TYPE_ACK = 0x80;
constexpr uint8_t ST_OK = 0x00, ST_CRC = 0x01, ST_VERSION = 0x02, ST_TYPE = 0x03, ST_LENGTH = 0x04, ST_GRID = 0x05;

// Incoming Bluetooth writes, queued here and handled in loop().
constexpr int QSLOTS = 4;
constexpr int QMAX = 182;
uint8_t qData[QSLOTS][QMAX];
size_t qLen[QSLOTS];
volatile int qHead = 0;
volatile int qTail = 0;
portMUX_TYPE qLock = portMUX_INITIALIZER_UNLOCKED;

BLECharacteristic* ackChar = nullptr;
volatile bool connected = false;
volatile bool justConnected = false;
volatile bool justDisconnected = false;

// Message reassembly
uint8_t msg[64];
size_t msgLen = 0;
int expectIndex = -1;
uint16_t asmId = 0;
uint8_t asmCount = 0;
unsigned long lastChunkMs = 0;

// De-duplication of app retries
uint16_t lastId = 0;
uint8_t lastType = 0;
uint8_t lastStatus = 0;

// Servo state. The board can't sense the pin, so it assumes the pin starts lowered.
bool pinRaised = false;   // where the pin is (or is heading)
bool moving = false;
unsigned long moveStart = 0;
unsigned long moveMs = 0;

// ---------------------------------------------------------------- servo
void setServo(int us) {
  ledcWrite(SERVO_PIN, (uint32_t)us * 65535 / 20000);  // 50 Hz, 16-bit
}

void stopServo() {
  ledcWrite(SERVO_PIN, 0);  // no pulses: the servo stops
  moving = false;
}

// Turn toward raised or lowered. Does nothing if the pin is already there.
// If it's halfway through the opposite move, it reverses for only as long as it already turned.
void movePin(bool raise) {
  if (raise == pinRaised) return;
  unsigned long ms = raise ? RAISE_MS : LOWER_MS;
  if (moving) ms = min(ms, millis() - moveStart);  // undo only the part already done
  pinRaised = raise;
  moving = true;
  moveStart = millis();
  moveMs = ms;
  setServo(raise ? RAISE_US : LOWER_US);
  Serial.printf("Servo: %s for %lu ms\n", raise ? "RAISING" : "LOWERING", ms);
}

void updateServo() {
  if (moving && millis() - moveStart >= moveMs) {
    stopServo();
    Serial.println(pinRaised ? "Servo: stopped, pin UP" : "Servo: stopped, pin DOWN");
  }
}

// ---------------------------------------------------------------- protocol
uint16_t crc16(const uint8_t* d, size_t n) {
  uint16_t crc = 0xFFFF;
  for (size_t i = 0; i < n; i++) {
    crc ^= (uint16_t)d[i] << 8;
    for (int b = 0; b < 8; b++) crc = (crc & 0x8000) ? (uint16_t)((crc << 1) ^ 0x1021) : (uint16_t)(crc << 1);
  }
  return crc;
}

void sendAck(uint16_t id, uint8_t ackedType, uint8_t status) {
  uint8_t a[10] = {0x01, TYPE_ACK, (uint8_t)(id & 0xFF), (uint8_t)(id >> 8), 0x02, 0x00, ackedType, status, 0, 0};
  uint16_t crc = crc16(a, 8);
  a[8] = crc & 0xFF;
  a[9] = crc >> 8;
  if (ackChar && connected) {
    ackChar->setValue(a, sizeof(a));
    ackChar->notify();
  }
}

void handleMessage(const uint8_t* m, size_t n) {
  if (n < 8) return;  // too short to read: stay silent, the app retries
  const uint8_t version = m[0];
  const uint8_t type = m[1];
  const uint16_t id = m[2] | (m[3] << 8);
  const uint16_t plen = m[4] | (m[5] << 8);

  if ((size_t)plen + 8 != n) { sendAck(id, type, ST_LENGTH); return; }
  const uint16_t got = m[n - 2] | (m[n - 1] << 8);
  if (crc16(m, n - 2) != got) { sendAck(id, type, ST_CRC); return; }

  // A retry of the last command: answer the same, don't act twice.
  if (id == lastId && type == lastType) { sendAck(id, type, lastStatus); return; }

  uint8_t status = ST_OK;
  if (version != 0x01) {
    status = ST_VERSION;
  } else if (type == TYPE_SET_PATTERN) {
    const int bitmapBytes = (ROWS * COLS + 7) / 8;
    if (plen != 2 + bitmapBytes) status = ST_LENGTH;
    else if (m[6] != ROWS || m[7] != COLS) status = ST_GRID;
    else {
      const uint8_t* bitmap = m + 8;
      const bool raised = (bitmap[CONTROL_PIN / 8] >> (CONTROL_PIN % 8)) & 1;
      movePin(raised);
    }
  } else if (type == TYPE_RESET) {
    if (plen != 0) status = ST_LENGTH;
    else movePin(false);
  } else {
    status = ST_TYPE;
  }

  lastId = id;
  lastType = type;
  lastStatus = status;
  sendAck(id, type, status);
}

// Each Bluetooth write is a chunk: commandId (2), chunkIndex (1), chunkCount (1), then message bytes.
void handleChunk(const uint8_t* c, size_t n) {
  if (n < 5) return;
  const uint16_t id = c[0] | (c[1] << 8);
  const uint8_t idx = c[2];
  const uint8_t cnt = c[3];
  if (cnt == 0 || idx >= cnt) { expectIndex = -1; return; }

  if (idx == 0) {
    msgLen = 0;
    asmId = id;
    asmCount = cnt;
  } else if (expectIndex < 0 || id != asmId || cnt != asmCount || idx != expectIndex ||
             millis() - lastChunkMs > 2000) {
    expectIndex = -1;  // out of order: drop the partial message
    return;
  }

  const size_t part = n - 4;
  if (msgLen + part > sizeof(msg)) { expectIndex = -1; return; }
  memcpy(msg + msgLen, c + 4, part);
  msgLen += part;
  lastChunkMs = millis();

  if (idx + 1 == cnt) {
    expectIndex = -1;
    handleMessage(msg, msgLen);
  } else {
    expectIndex = idx + 1;
  }
}

// ---------------------------------------------------------------- Bluetooth
class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer*) override {
    connected = true;
    justConnected = true;
  }
  void onDisconnect(BLEServer*) override {
    connected = false;
    justDisconnected = true;
  }
};

class CommandCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    const uint8_t* data = c->getData();
    const size_t n = c->getLength();
    if (n == 0 || n > QMAX) return;
    portENTER_CRITICAL(&qLock);
    const int next = (qTail + 1) % QSLOTS;
    if (next != qHead) {  // if full, drop it; the app retries
      memcpy(qData[qTail], data, n);
      qLen[qTail] = n;
      qTail = next;
    }
    portEXIT_CRITICAL(&qLock);
  }
};

void startBluetooth() {
  BLEDevice::init(DEVICE_NAME);
  BLEDevice::setMTU(185);
  BLEServer* server = BLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());

  BLEService* service = server->createService(SERVICE_UUID);
  BLECharacteristic* command = service->createCharacteristic(COMMAND_UUID, BLECharacteristic::PROPERTY_WRITE);
  command->setCallbacks(new CommandCallbacks());
  ackChar = service->createCharacteristic(ACK_UUID, BLECharacteristic::PROPERTY_NOTIFY);
  ackChar->addDescriptor(new BLE2902());
  service->start();

  // Service UUID in the advertisement, name in the scan response (both don't fit in one).
  BLEAdvertising* adv = BLEDevice::getAdvertising();
  BLEAdvertisementData data;
  data.setFlags(0x06);
  data.setCompleteServices(BLEUUID(SERVICE_UUID));
  BLEAdvertisementData scan;
  scan.setName(DEVICE_NAME);
  adv->setAdvertisementData(data);
  adv->setScanResponseData(scan);
  BLEDevice::startAdvertising();
  Serial.println("Advertising as " DEVICE_NAME);
}

// ---------------------------------------------------------------- main
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("PinVisual one-servo Bluetooth test");
  ledcAttach(SERVO_PIN, 50, 16);
  ledcWrite(SERVO_PIN, 0);  // start stopped
  startBluetooth();
  Serial.println("In the app: raise pin 0 to raise, lower it or Reset to lower.");
  Serial.println("Serial Monitor: u = raise, d = lower, s = stop now, r1500 / l1500 = set raise/lower time in ms.");
}

void loop() {
  if (justConnected) {
    justConnected = false;
    lastId = 0;  // the app may start its command numbers again
    expectIndex = -1;
    Serial.println("App connected");
  }
  if (justDisconnected) {
    justDisconnected = false;
    Serial.println("App disconnected, advertising again");  // a move in progress still finishes
    delay(100);
    BLEDevice::startAdvertising();
  }

  // Handle queued Bluetooth writes
  while (true) {
    uint8_t buf[QMAX];
    size_t n = 0;
    bool got = false;
    portENTER_CRITICAL(&qLock);
    if (qHead != qTail) {
      n = qLen[qHead];
      memcpy(buf, qData[qHead], n);
      qHead = (qHead + 1) % QSLOTS;
      got = true;
    }
    portEXIT_CRITICAL(&qLock);
    if (!got) break;
    handleChunk(buf, n);
  }

  // Serial Monitor control and calibration
  if (Serial.available()) {
    String line = Serial.readStringUntil('\n');
    line.trim();
    if (line == "u") movePin(true);
    else if (line == "d") movePin(false);
    else if (line == "s") { stopServo(); Serial.println("Servo: stopped by hand (position may be off)"); }
    else if (line.startsWith("r") && line.length() > 1) { RAISE_MS = line.substring(1).toInt(); Serial.printf("Raise time %lu ms\n", RAISE_MS); }
    else if (line.startsWith("l") && line.length() > 1) { LOWER_MS = line.substring(1).toInt(); Serial.printf("Lower time %lu ms\n", LOWER_MS); }
    else if (line == "f") { pinRaised = !pinRaised; Serial.println(pinRaised ? "Now assuming pin is UP" : "Now assuming pin is DOWN"); }
  }

  updateServo();
  delay(5);
}