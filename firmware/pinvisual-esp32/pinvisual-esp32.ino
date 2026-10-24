// PinVisual board firmware for an ESP32 with PCA9685 servo boards.
//
// The app connects over Bluetooth Low Energy and sends pin patterns (docs/PROTOCOL.md); this sketch moves one
// servo per pin. Settings are in config.h, wiring and setup in README.md.
//
// Needs (Arduino IDE, Library Manager / Boards Manager):
//   - "esp32" by Espressif Systems (board support; includes the BLE library)
//   - "Adafruit PWM Servo Driver Library" by Adafruit
//
// Serial monitor (115200 baud), for wiring checks and calibration:
//   s            status
//   u            raise every pin        d   lower every pin
//   p <pin> <us> hold one pin at a pulse width, e.g. "p 0 1500"
//   t <pin>      raise one pin for a second, then lower it (which servo is pin N?)
#include <Adafruit_PWMServoDriver.h>
#include <BLE2902.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <Wire.h>

#include "config.h"
#include "protocol.h"

using namespace pinvisual;

constexpr int kPins = PV_ROWS * PV_COLS;
constexpr int kBoards = (kPins + PV_CHANNELS_PER_BOARD - 1) / PV_CHANNELS_PER_BOARD;

// ---------------------------------------------------------------------------------------------------------------
// Servos

class ServoBoards : public PinOutput {
 public:
  void begin() {
    Wire.begin(PV_I2C_SDA, PV_I2C_SCL);
    for (int b = 0; b < kBoards; b++) {
      drivers_[b] = Adafruit_PWMServoDriver(PV_FIRST_I2C_ADDRESS + b, Wire);
      drivers_[b].begin();
      drivers_[b].setOscillatorFrequency(PV_OSCILLATOR_HZ);
      drivers_[b].setPWMFreq(PV_SERVO_HZ);
    }
    for (int i = 0; i < kPins; i++) known_[i] = false;
  }

  // Every board answers on the I2C bus.
  bool boardsPresent() {
    for (int b = 0; b < kBoards; b++) {
      Wire.beginTransmission(PV_FIRST_I2C_ADDRESS + b);
      if (Wire.endTransmission() != 0) return false;
    }
    return true;
  }

  // The protocol code has already checked that rows x cols is this board's grid (config.h).
  bool show(const uint8_t* bitmap, uint8_t /*rows*/, uint8_t /*cols*/) override {
    bool up[kPins];
    for (int i = 0; i < kPins; i++) up[i] = pinRaised(bitmap, i);
    return moveTo(up);
  }

  bool lowerAll() override {
    bool up[kPins] = {false};
    return moveTo(up);
  }

  bool raiseAll() {
    bool up[kPins];
    for (int i = 0; i < kPins; i++) up[i] = true;
    return moveTo(up);
  }

  // Calibration: hold one pin at any pulse width (it is then no longer at a known position).
  void hold(int pin, int us) {
    if (pin < 0 || pin >= kPins) return;
    pulse(pin, us);
    known_[pin] = false;
  }

  int raisedCount() const {
    int n = 0;
    for (int i = 0; i < kPins; i++) n += known_[i] && raised_[i];
    return n;
  }

 private:
  // Only pins that change are moved, a few at a time (see PV_MOVE_GROUP in config.h).
  bool moveTo(const bool* up) {
    if (!boardsPresent()) return false;
    int inGroup = 0;
    for (int i = 0; i < kPins; i++) {
      if (known_[i] && raised_[i] == up[i]) continue;
      pulse(i, (up[i] ? PV_RAISED_US : PV_LOWERED_US) + PV_PIN_TRIM_US[i]);
      raised_[i] = up[i];
      known_[i] = true;
      if (++inGroup >= PV_MOVE_GROUP) {
        delay(PV_MOVE_PAUSE_MS);
        inGroup = 0;
      }
    }
    return true;
  }

  void pulse(int pin, int us) {
    drivers_[pin / PV_CHANNELS_PER_BOARD].writeMicroseconds(pin % PV_CHANNELS_PER_BOARD, us);
  }

  Adafruit_PWMServoDriver drivers_[kBoards];
  bool raised_[kPins] = {false};
  bool known_[kPins] = {false};
};

ServoBoards servos;
Board board(PV_ROWS, PV_COLS, servos);

// ---------------------------------------------------------------------------------------------------------------
// Bluetooth

BLECharacteristic* ackCharacteristic = nullptr;
volatile bool connected = false;
volatile bool restartAdvertising = false;

// Writes arrive on the Bluetooth task; they are queued and handled in loop(), where moving servos may take a while.
constexpr int kQueueSlots = 8;
constexpr size_t kMaxWrite = PV_MTU - 3;
struct Write {
  uint8_t data[kMaxWrite];
  size_t length;
};
Write queue[kQueueSlots];
volatile int queueHead = 0;  // next to read
volatile int queueTail = 0;  // next to write
portMUX_TYPE queueLock = portMUX_INITIALIZER_UNLOCKED;

void enqueue(const uint8_t* data, size_t length) {
  if (length > kMaxWrite) return;  // bigger than any write the app makes: ignore (the app retries)
  portENTER_CRITICAL(&queueLock);
  const int next = (queueTail + 1) % kQueueSlots;
  if (next != queueHead) {  // full: drop it; the app's retry brings it back
    memcpy(queue[queueTail].data, data, length);
    queue[queueTail].length = length;
    queueTail = next;
  }
  portEXIT_CRITICAL(&queueLock);
}

bool dequeue(Write& out) {
  bool got = false;
  portENTER_CRITICAL(&queueLock);
  if (queueHead != queueTail) {
    out = queue[queueHead];
    queueHead = (queueHead + 1) % kQueueSlots;
    got = true;
  }
  portEXIT_CRITICAL(&queueLock);
  return got;
}

class CommandCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override { enqueue(c->getData(), c->getLength()); }
};

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer*) override {
    connected = true;
    Serial.println("App connected");
  }
  void onDisconnect(BLEServer*) override {
    connected = false;
    restartAdvertising = true;
    Serial.println("App disconnected");
  }
};

void startBluetooth() {
  BLEDevice::init(PV_DEVICE_NAME);
  BLEDevice::setMTU(PV_MTU);
  BLEServer* server = BLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());

  BLEService* service = server->createService(PV_SERVICE_UUID);
  BLECharacteristic* command = service->createCharacteristic(PV_COMMAND_UUID, BLECharacteristic::PROPERTY_WRITE);
  command->setCallbacks(new CommandCallbacks());
  ackCharacteristic = service->createCharacteristic(PV_ACK_UUID, BLECharacteristic::PROPERTY_NOTIFY);
  ackCharacteristic->addDescriptor(new BLE2902());  // lets the app switch notifications on
  service->start();

  // The service UUID in the advertisement (so the app and the browser's picker find the board) and the name in
  // the scan response (both don't fit in one 31-byte advertisement).
  BLEAdvertising* advertising = BLEDevice::getAdvertising();
  BLEAdvertisementData data;
  data.setFlags(0x06);  // general discoverable, no classic Bluetooth
  data.setCompleteServices(BLEUUID(PV_SERVICE_UUID));
  BLEAdvertisementData scan;
  scan.setName(PV_DEVICE_NAME);
  advertising->setAdvertisementData(data);
  advertising->setScanResponseData(scan);
  BLEDevice::startAdvertising();
  Serial.printf("Advertising as %s\n", PV_DEVICE_NAME);
}

// ---------------------------------------------------------------------------------------------------------------
// Serial commands (calibration)

void serialCommand(String line) {
  line.trim();
  if (line.isEmpty()) return;
  const char cmd = line[0];
  int a = -1;
  int b = -1;
  sscanf(line.c_str() + 1, "%d %d", &a, &b);
  if (cmd == 's') {
    Serial.printf("%dx%d grid, %d pins on %d board(s): %s. %s. %d raised. %lu patterns applied.\n", PV_ROWS, PV_COLS, kPins,
                  kBoards, servos.boardsPresent() ? "all answering" : "A BOARD IS NOT ANSWERING (check wiring and address)",
                  connected ? "App connected" : "Waiting for the app", servos.raisedCount(),
                  static_cast<unsigned long>(board.applied()));
  } else if (cmd == 'u') {
    Serial.println(servos.raiseAll() ? "All raised" : "Failed: a servo board is not answering");
  } else if (cmd == 'd') {
    Serial.println(servos.lowerAll() ? "All lowered" : "Failed: a servo board is not answering");
  } else if (cmd == 'p' && a >= 0 && a < kPins && b >= 400 && b <= 2600) {
    servos.hold(a, b);
    Serial.printf("Pin %d (row %d, column %d) at %d us\n", a, a / PV_COLS, a % PV_COLS, b);
  } else if (cmd == 't' && a >= 0 && a < kPins) {
    Serial.printf("Pin %d: row %d, column %d (board 0x%02X, channel %d)\n", a, a / PV_COLS, a % PV_COLS,
                  PV_FIRST_I2C_ADDRESS + a / PV_CHANNELS_PER_BOARD, a % PV_CHANNELS_PER_BOARD);
    servos.hold(a, PV_RAISED_US + PV_PIN_TRIM_US[a]);
    delay(1000);
    servos.hold(a, PV_LOWERED_US + PV_PIN_TRIM_US[a]);
  } else {
    Serial.println("Commands: s (status), u (raise all), d (lower all), p <pin> <us>, t <pin>");
  }
}

// ---------------------------------------------------------------------------------------------------------------

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("PinVisual board starting");
  servos.begin();
  if (!servos.boardsPresent()) Serial.println("WARNING: a servo board is not answering on I2C. Check SDA/SCL, power and the address jumpers.");
#if PV_LOWER_ON_START
  servos.lowerAll();
#endif
  startBluetooth();
}

void loop() {
  Write w;
  while (dequeue(w)) {
    uint8_t ack[kAckSize];
    if (board.receive(w.data, w.length, millis(), ack) && connected && ackCharacteristic) {
      ackCharacteristic->setValue(ack, kAckSize);
      ackCharacteristic->notify();
    }
  }
  if (restartAdvertising) {
    restartAdvertising = false;
#if PV_LOWER_ON_DISCONNECT
    servos.lowerAll();
#endif
    delay(200);  // let the Bluetooth stack finish the disconnect
    BLEDevice::startAdvertising();
    Serial.println("Advertising again");
  }
  if (Serial.available()) serialCommand(Serial.readStringUntil('\n'));
  delay(2);
}
