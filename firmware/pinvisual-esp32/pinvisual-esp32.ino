// PinVisual 3 x 3 continuous-rotation servo board.
#include <BLE2902.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <atomic>
#include <freertos/queue.h>
#include <utility>

#include "config.h"
#include "protocol.h"

#if PV_SERVO_BOARDS
#include <Adafruit_PWMServoDriver.h>
#include <Wire.h>
#endif

namespace {

constexpr int kUpUs = 1400;
constexpr int kDownUs = 1600;
constexpr size_t kPinCount = PV_ROWS * PV_COLS;
constexpr size_t kFirstPin = PV_SERVO_BOARDS ? 0 : PV_TEST_PIN;
constexpr size_t kPinLimit = PV_SERVO_BOARDS ? kPinCount : PV_TEST_PIN + 1;
constexpr size_t kBatchSize = 2;
constexpr unsigned long kBatchPauseMs = 100;
constexpr size_t kMaxBatches = PV_COLS * ((PV_ROWS + kBatchSize - 1) / kBatchSize);
// Leave time for I2C writes and the BLE acknowledgement within the app's 3 s timeout.
constexpr unsigned long kMaxTurnMs =
    PV_SERVO_BOARDS ? (2600 - (kMaxBatches - 1) * kBatchPauseMs) / kMaxBatches : 2000;
static_assert(PV_TEST_PIN >= 0 && PV_TEST_PIN < PV_ROWS * PV_COLS, "Invalid test pin");
static_assert(!PV_SERVO_BOARDS || kPinCount <= PV_CHANNELS_PER_BOARD, "Grid exceeds one PCA9685");
static_assert(PV_SERVO_TURN_MS >= 20 && PV_SERVO_TURN_MS <= kMaxTurnMs, "Invalid servo turn time");

class ServoGrid : public pinvisual::PinOutput {
 public:
  void begin() {
#if PV_SERVO_BOARDS
    if (!Wire.begin(PV_I2C_SDA, PV_I2C_SCL) || !driver_.begin()) {
      Serial.printf("PCA9685 0x%02X not detected (SDA GPIO%d, SCL GPIO%d)\n",
                    PV_FIRST_I2C_ADDRESS, PV_I2C_SDA, PV_I2C_SCL);
      return;
    }
    driver_.setOscillatorFrequency(PV_OSCILLATOR_HZ);
    driver_.setPWMFreq(PV_SERVO_HZ);
#else
    if (!ledcAttach(PV_DIRECT_GPIO, PV_SERVO_HZ, 16)) {
      Serial.println("Servo output initialization failed");
      return;
    }
#endif
    for (size_t pin = kFirstPin; pin < kPinLimit; ++pin) stopPending_[pin] = true;
    ready_ = retryStop();
    if (!ready_) {
      Serial.println("Servo output initialization failed");
      return;
    }
#if PV_SERVO_BOARDS
    Serial.printf("PCA9685 0x%02X detected, servo channels 0-%u\n",
                  PV_FIRST_I2C_ADDRESS, static_cast<unsigned>(kPinCount - 1));
#else
    Serial.printf("Servo signal on GPIO%d\n", PV_DIRECT_GPIO);
#endif
  }

  bool show(const uint8_t* bitmap, uint8_t, uint8_t) override {
    bool target[kPinCount]{};
    for (size_t pin = kFirstPin; pin < kPinLimit; ++pin) {
      target[pin] = pinvisual::pinRaised(bitmap, pin);
    }
    return move(target);
  }

  bool lowerAll() override {
    const bool target[kPinCount]{};
    return move(target);
  }

  bool retryStop() {
    bool stopped = true;
    for (size_t pin = kFirstPin; pin < kPinLimit; ++pin) {
      if (stopPending_[pin] && !stop(pin)) stopped = false;
    }
    return stopped;
  }

  void serialCommand(const String& line) {
    if (line == "s") {
      Serial.printf("Servo output %s. Turn time %lu ms. Assumed pin positions:\n",
                    ready_ ? "ready" : "unavailable", turnMs_);
      for (size_t pin = kFirstPin; pin < kPinLimit; ++pin) {
        Serial.printf("  %u: %s\n", static_cast<unsigned>(pin + 1), raiseDurationMs_[pin] != 0 ? "UP" : "DOWN");
      }
    } else if (line.startsWith("u") || line.startsWith("d")) {
      const long number = line.length() == 1 ? PV_TEST_PIN + 1 : line.substring(1).toInt();
      if (number <= static_cast<long>(kFirstPin) || number > static_cast<long>(kPinLimit)) {
        Serial.printf("Enter a pin number from %u to %u\n",
                      static_cast<unsigned>(kFirstPin + 1), static_cast<unsigned>(kPinLimit));
        return;
      }
      bool target[kPinCount]{};
      for (size_t pin = kFirstPin; pin < kPinLimit; ++pin) {
        target[pin] = raiseDurationMs_[pin] != 0;
      }
      target[number - 1] = line[0] == 'u';
      move(target);
    } else if (line.startsWith("t")) {
      const long ms = line.substring(1).toInt();
      if (ms >= 20 && ms <= static_cast<long>(kMaxTurnMs)) {
        turnMs_ = ms;
        Serial.printf("Turn time %lu ms\n", turnMs_);
      } else {
        Serial.printf("Use t20 through t%lu to set the turn time in ms\n", kMaxTurnMs);
      }
    }
  }

 private:
  bool move(const bool (&target)[kPinCount]) {
    if (!ready_) {
      Serial.println("Servo output unavailable. Check wiring and restart the ESP32.");
      return false;
    }
#if PV_SERVO_BOARDS
    bool moved = false;
    for (size_t column = 0; column < PV_COLS; ++column) {
      size_t pins[PV_ROWS];
      size_t count = 0;
      for (size_t row = 0; row < PV_ROWS; ++row) {
        const size_t pin = row * PV_COLS + column;
        if (target[pin] != (raiseDurationMs_[pin] != 0)) pins[count++] = pin;
      }
      for (size_t offset = 0; offset < count; offset += kBatchSize) {
        if (moved) delay(kBatchPauseMs);
        const size_t remaining = count - offset;
        const size_t batchCount = remaining < kBatchSize ? remaining : kBatchSize;
        if (!moveBatch(pins + offset, batchCount, target)) return false;
        moved = true;
      }
    }
    return true;
#else
    const size_t pin = PV_TEST_PIN;
    return target[pin] == (raiseDurationMs_[pin] != 0) || moveBatch(&pin, 1, target);
#endif
  }

  bool moveBatch(const size_t* pins, size_t count, const bool (&target)[kPinCount]) {
    struct TimedStop {
      size_t pin;
      unsigned long afterMs;
    };
    TimedStop stops[kBatchSize];
    const unsigned long batchStart = millis();
    for (size_t i = 0; i < count; ++i) {
      const size_t pin = pins[i];
      // A failed I2C write may still have started the servo, so attempt to stop it too.
      stopPending_[pin] = true;
      if (!writePulse(pin, target[pin] ? kUpUs : kDownUs)) {
        retryStop();
        return outputFault();
      }
      const unsigned long duration = target[pin] ? turnMs_ : raiseDurationMs_[pin];
      stops[i] = {pin, (millis() - batchStart) + duration};
    }
    // Two pins can have different turn times if the setting changed while one was up.
    if (count == 2 && stops[1].afterMs < stops[0].afterMs) {
      std::swap(stops[0], stops[1]);
    }
    // Runs in loop(), outside the BLE callback. The board acknowledges after all batches stop.
    for (size_t i = 0; i < count; ++i) {
      const auto [pin, afterMs] = stops[i];
      const unsigned long elapsed = millis() - batchStart;
      if (elapsed < afterMs) delay(afterMs - elapsed);
      if (!stop(pin)) {
        retryStop();
        return outputFault();
      }
      raiseDurationMs_[pin] = target[pin] ? turnMs_ : 0;
    }
    return true;
  }

  bool writePulse(size_t pin, uint32_t us) {
#if PV_SERVO_BOARDS
    // Convert the pulse width to the PCA9685's 4096 ticks per frame.
    const uint16_t ticks = (us * PV_SERVO_HZ * 4096 + 500000) / 1000000;
    return driver_.setPWM(pin, 0, ticks) == 0;
#else
    return pin == PV_TEST_PIN && ledcWrite(PV_DIRECT_GPIO, us * PV_SERVO_HZ * 65535 / 1000000);
#endif
  }

  bool stop(size_t pin) {
#if PV_SERVO_BOARDS
    stopPending_[pin] = driver_.setPWM(pin, 0, 4096) != 0;  // Full off: no pulses.
#else
    stopPending_[pin] = !ledcWrite(PV_DIRECT_GPIO, 0);
#endif
    return !stopPending_[pin];
  }

  bool outputFault() {
    ready_ = false;
    Serial.println("Servo output write failed. Check wiring, lower the pins and restart the ESP32.");
    return false;
  }

#if PV_SERVO_BOARDS
  Adafruit_PWMServoDriver driver_{PV_FIRST_I2C_ADDRESS};
#endif
  bool ready_ = false;
  bool stopPending_[kPinCount]{};
  // Zero means lowered. Each raised pin stores how long it should spin in reverse.
  unsigned long raiseDurationMs_[kPinCount]{};
  unsigned long turnMs_ = PV_SERVO_TURN_MS;
};

struct CommandWrite {
  size_t length;
  uint8_t bytes[PV_MTU - 3];
};

ServoGrid servos;
pinvisual::Board board(PV_ROWS, PV_COLS, servos);
QueueHandle_t writes;
BLECharacteristic* ackChar;
std::atomic<bool> restartAdv{false};

class Cmd : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    CommandWrite write{};
    write.length = c->getLength();
    if (write.length == 0 || write.length > sizeof(write.bytes)) return;
    memcpy(write.bytes, c->getData(), write.length);
    xQueueSend(writes, &write, 0);  // If full, the app retries after its ACK timeout.
  }
};

class Srv : public BLEServerCallbacks {
  void onConnect(BLEServer*) override { Serial.println("App connected"); }
  void onDisconnect(BLEServer*) override { restartAdv = true; }
};

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(500);
  servos.begin();
  Serial.println("Serial Monitor: s = status, u/d = test pin up/down, u<n>/d<n> = pin n, t<ms> = turn time");

  writes = xQueueCreate(4, sizeof(CommandWrite));
  if (!writes) {
    Serial.println("Could not initialize the Bluetooth command queue");
    return;
  }

  BLEDevice::init(PV_DEVICE_NAME);
  BLEDevice::setMTU(PV_MTU);
  BLEServer* server = BLEDevice::createServer();
  server->setCallbacks(new Srv());
  BLEService* service = server->createService(PV_SERVICE_UUID);
  service->createCharacteristic(PV_COMMAND_UUID, BLECharacteristic::PROPERTY_WRITE)->setCallbacks(new Cmd());
  ackChar = service->createCharacteristic(PV_ACK_UUID, BLECharacteristic::PROPERTY_NOTIFY);
  ackChar->addDescriptor(new BLE2902());
  service->start();

  BLEAdvertisementData adv, scan;
  adv.setFlags(0x06);
  adv.setCompleteServices(BLEUUID(PV_SERVICE_UUID));
  scan.setName(PV_DEVICE_NAME);
  BLEDevice::getAdvertising()->setAdvertisementData(adv);
  BLEDevice::getAdvertising()->setScanResponseData(scan);
  BLEDevice::startAdvertising();
  Serial.println("Advertising as " PV_DEVICE_NAME);
}

void loop() {
  servos.retryStop();
  if (restartAdv.exchange(false)) {
    xQueueReset(writes);
    board.resetSession();
    delay(100);
    BLEDevice::startAdvertising();
    Serial.println("App disconnected");
  }

  CommandWrite write;
  uint8_t ack[pinvisual::kAckSize];
  if (writes && xQueueReceive(writes, &write, 0) == pdTRUE &&
      board.receive(write.bytes, write.length, millis(), ack) && !restartAdv) {
    ackChar->setValue(ack, sizeof(ack));
    ackChar->notify();
  }

  if (Serial.available()) {
    String line = Serial.readStringUntil('\n');
    line.trim();
    servos.serialCommand(line);
  }
  delay(5);
}
