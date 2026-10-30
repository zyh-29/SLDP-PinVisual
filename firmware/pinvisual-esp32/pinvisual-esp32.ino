// PinVisual, 1 pin + Bluetooth, for a 360 (continuous-rotation) servo. Signal on D18.
// App: Raise Pin -> turns one way for TURN_MS, then stops. Lower/Reset -> turns back the other way, then stops.
// Serial Monitor: u = up, d = down, t150 = set turn time to 150 ms (to tune the angle).
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLE2902.h>

#define SERVICE_UUID "7a1e0001-3c4b-4f2a-9b8e-5d6c7b8a9f01"
#define COMMAND_UUID "7a1e0002-3c4b-4f2a-9b8e-5d6c7b8a9f01"
#define ACK_UUID     "7a1e0003-3c4b-4f2a-9b8e-5d6c7b8a9f01"
const int SERVO_PIN = 18;
const int SPIN_UP_US = 1400;    // turn direction for UP (1500 = stop). Swap the two if it turns the wrong way.
const int SPIN_DOWN_US = 1600;  // turn direction for DOWN
unsigned long TURN_MS = 150;    // how long each turn lasts: longer = bigger angle

bool pinUp = false;             // the board assumes the pin starts DOWN
bool moving = false;
unsigned long moveStart = 0;

BLECharacteristic* ackChar;
uint8_t rx[64];
volatile int rxLen = 0;   // set by Bluetooth, handled in loop()
volatile bool restartAdv = false;
uint16_t lastId = 0;

void setServo(int us) { ledcWrite(SERVO_PIN, (uint32_t)us * 65535 / 20000); }
void stopServo() { ledcWrite(SERVO_PIN, 0); moving = false; }  // no pulses = stopped

void movePin(bool up) {
  if (up == pinUp) return;  // already there: don't turn again
  pinUp = up;
  setServo(up ? SPIN_UP_US : SPIN_DOWN_US);
  moving = true;
  moveStart = millis();
  Serial.println(up ? "Turning UP" : "Turning DOWN");
}

uint16_t crc16(const uint8_t* d, int n) {
  uint16_t c = 0xFFFF;
  for (int i = 0; i < n; i++) {
    c ^= d[i] << 8;
    for (int b = 0; b < 8; b++) c = (c & 0x8000) ? (c << 1) ^ 0x1021 : c << 1;
  }
  return c;
}

void ack(uint16_t id, uint8_t type, uint8_t status) {
  uint8_t a[10] = {1, 0x80, (uint8_t)id, (uint8_t)(id >> 8), 2, 0, type, status, 0, 0};
  uint16_t c = crc16(a, 8);
  a[8] = c; a[9] = c >> 8;
  ackChar->setValue(a, 10);
  ackChar->notify();
}

// Write = 4-byte chunk header + message: ver, type, id(2), len(2), payload, crc(2)
void handle(const uint8_t* w, int n) {
  if (n < 12 || w[2] != 0 || w[3] != 1) return;  // only single-chunk messages (all a 5x6 grid needs)
  const uint8_t* m = w + 4;
  int mlen = n - 4;
  uint8_t type = m[1];
  uint16_t id = m[2] | (m[3] << 8);
  if ((m[4] | (m[5] << 8)) + 8 != mlen) { ack(id, type, 0x04); return; }
  if (crc16(m, mlen - 2) != (m[mlen - 2] | (m[mlen - 1] << 8))) { ack(id, type, 0x01); return; }
  if (id == lastId) { ack(id, type, 0x00); return; }  // app retry: already done
  lastId = id;
  if (type == 0x01 && m[6] == 5 && m[7] == 6) {
    movePin(m[8] & 1);  // pin 0 = top-left
    ack(id, type, 0x00);
  } else if (type == 0x01) {
    ack(id, type, 0x05);  // wrong grid size
  } else if (type == 0x02) {
    movePin(false);
    ack(id, type, 0x00);
  } else {
    ack(id, type, 0x03);
  }
}

class Cmd : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    int n = c->getLength();
    if (rxLen == 0 && n <= (int)sizeof(rx)) { memcpy(rx, c->getData(), n); rxLen = n; }
  }
};
class Srv : public BLEServerCallbacks {
  void onConnect(BLEServer*) override { lastId = 0; Serial.println("App connected"); }
  void onDisconnect(BLEServer*) override { restartAdv = true; }
};

void setup() {
  Serial.begin(115200);
  delay(500);
  ledcAttach(SERVO_PIN, 50, 16);
  stopServo();

  BLEDevice::init("PinVisual-01");
  BLEServer* s = BLEDevice::createServer();
  s->setCallbacks(new Srv());
  BLEService* svc = s->createService(SERVICE_UUID);
  svc->createCharacteristic(COMMAND_UUID, BLECharacteristic::PROPERTY_WRITE)->setCallbacks(new Cmd());
  ackChar = svc->createCharacteristic(ACK_UUID, BLECharacteristic::PROPERTY_NOTIFY);
  ackChar->addDescriptor(new BLE2902());
  svc->start();

  BLEAdvertisementData adv, scan;
  adv.setFlags(0x06);
  adv.setCompleteServices(BLEUUID(SERVICE_UUID));
  scan.setName("PinVisual-01");
  BLEDevice::getAdvertising()->setAdvertisementData(adv);
  BLEDevice::getAdvertising()->setScanResponseData(scan);
  BLEDevice::startAdvertising();
  Serial.println("Pin DOWN. Advertising as PinVisual-01");
}

void loop() {
  if (rxLen > 0) { handle(rx, rxLen); rxLen = 0; }
  if (restartAdv) { restartAdv = false; delay(100); BLEDevice::startAdvertising(); Serial.println("App disconnected"); }
  if (moving && millis() - moveStart >= TURN_MS) {
    stopServo();
    Serial.println(pinUp ? "Stopped: pin UP" : "Stopped: pin DOWN");
  }
  if (Serial.available()) {
    String line = Serial.readStringUntil('\n');
    line.trim();
    if (line == "u") movePin(true);
    if (line == "d") movePin(false);
    if (line.startsWith("t") && line.length() > 1) { TURN_MS = line.substring(1).toInt(); Serial.printf("Turn time %lu ms\n", TURN_MS); }
  }
  delay(5);
}