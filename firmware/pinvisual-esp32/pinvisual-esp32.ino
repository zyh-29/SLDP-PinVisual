// PinVisual 3 x 3 prototype. Only the servo for PV_TEST_PIN is installed.
#include <BLE2902.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <atomic>
#include <freertos/queue.h>

#include "config.h"
#include "protocol.h"

#if PV_SERVO_BOARDS
#include <Adafruit_PWMServoDriver.h>
#include <Wire.h>
#endif

namespace {

constexpr int kUpUs = 1400;
constexpr int kDownUs = 1600;
constexpr unsigned long kMaxTurnMs = 2000;  // Leave time for the BLE ACK within the app's 3 s timeout.
constexpr uint8_t kAddress = PV_FIRST_I2C_ADDRESS + PV_TEST_PIN / PV_CHANNELS_PER_BOARD;
constexpr uint8_t kChannel = PV_TEST_PIN % PV_CHANNELS_PER_BOARD;
static_assert(PV_TEST_PIN >= 0 && PV_TEST_PIN < PV_ROWS * PV_COLS, "Invalid test pin");

class TestServo : public pinvisual::PinOutput {
 public:
  void begin() {
#if PV_SERVO_BOARDS
    if (!Wire.begin(PV_I2C_SDA, PV_I2C_SCL) || !driver_.begin()) {
      Serial.printf("PCA9685 0x%02X not detected (SDA GPIO%d, SCL GPIO%d)\n", kAddress, PV_I2C_SDA, PV_I2C_SCL);
      return;
    }
    driver_.setOscillatorFrequency(PV_OSCILLATOR_HZ);
    driver_.setPWMFreq(PV_SERVO_HZ);
    ready_ = stop();
    if (ready_) Serial.printf("PCA9685 0x%02X detected, servo on channel %u\n", kAddress, kChannel);
#else
    ready_ = ledcAttach(PV_DIRECT_GPIO, PV_SERVO_HZ, 16) && stop();
    if (ready_) Serial.printf("Servo signal on GPIO%d\n", PV_DIRECT_GPIO);
#endif
    if (!ready_) Serial.println("Servo output initialization failed");
  }

  bool show(const uint8_t* bitmap, uint8_t, uint8_t) override {
    return move(pinvisual::pinRaised(bitmap, PV_TEST_PIN));
  }

  bool lowerAll() override { return move(false); }

  bool move(bool up) {
    if (!ready_) {
      Serial.println("Servo output unavailable. Check wiring and restart the ESP32.");
      return false;
    }
    if (up == pinUp_) return true;

    if (!writePulse(up ? kUpUs : kDownUs)) {
      stop();
      return outputFault();
    }
    Serial.printf("Turning %s for %lu ms\n", up ? "UP" : "DOWN", turnMs_);
    // Runs in loop(), outside the BLE callback. The protocol sends its ACK after stop().
    delay(turnMs_);
    if (!stop()) return outputFault();
    pinUp_ = up;
    Serial.printf("Stopped: pin %s\n", up ? "UP" : "DOWN");
    return true;
  }

  void retryStop() {
    if (stopPending_) stop();
  }

  void serialCommand(const String& line) {
    if (line == "u") move(true);
    if (line == "d") move(false);
    if (line == "s") {
      Serial.printf("Servo output %s. Assumed pin position %s. Turn time %lu ms.\n",
                    ready_ ? "ready" : "unavailable", pinUp_ ? "UP" : "DOWN", turnMs_);
    }
    if (line.startsWith("t")) {
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
  bool writePulse(uint32_t us) {
#if PV_SERVO_BOARDS
    // Convert the pulse width to the PCA9685's 4096 ticks per frame.
    const uint16_t ticks = (us * PV_SERVO_HZ * 4096 + 500000) / 1000000;
    return driver_.setPWM(kChannel, 0, ticks) == 0;
#else
    return ledcWrite(PV_DIRECT_GPIO, us * PV_SERVO_HZ * 65535 / 1000000);
#endif
  }

  bool stop() {
#if PV_SERVO_BOARDS
    stopPending_ = driver_.setPWM(kChannel, 0, 4096) != 0;  // Full off: no pulses.
#else
    stopPending_ = !ledcWrite(PV_DIRECT_GPIO, 0);
#endif
    return !stopPending_;
  }

  bool outputFault() {
    ready_ = false;
    Serial.println("Servo output write failed. Check wiring, place the pin DOWN and restart the ESP32.");
    return false;
  }

#if PV_SERVO_BOARDS
  Adafruit_PWMServoDriver driver_{kAddress};
#endif
  bool ready_ = false;
  bool stopPending_ = false;
  bool pinUp_ = false;  // No feedback. Start with the mechanism physically lowered.
  unsigned long turnMs_ = 150;
};

struct CommandWrite {
  size_t length;
  uint8_t bytes[PV_MTU - 3];
};

TestServo servo;
pinvisual::Board board(PV_ROWS, PV_COLS, servo);
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
  servo.begin();
  Serial.println("Serial Monitor: s = status, u = up, d = down, t150 = turn time in ms");

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
  servo.retryStop();
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
    servo.serialCommand(line);
  }
  delay(5);
}
