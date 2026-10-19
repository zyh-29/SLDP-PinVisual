import { GRID } from '@/config/hardware';
import { DEFAULT_MTU, maxWriteSizeForMtu } from '@/protocol/chunking';
import type { DeviceDriver, DeviceLink, ScanHandle, Transport } from '../../types';
import { type MockBehavior, MockFirmware } from './MockFirmware';

export const MOCK_DEVICE_ID = 'mock-device';
export const MOCK_DEVICE_NAME = 'Mock Board (simulated)';

/**
 * Simulated board, for tests only (the app connects to real boards over Bluetooth). Uses the default BLE MTU (23 bytes -> 20-byte writes) so
 * chunking is exercised exactly as on a real link that never negotiated a
 * larger MTU.
 */
export class MockDriver implements DeviceDriver {
  behavior: MockBehavior = 'normal';
  /** The firmware model of the currently connected mock link, if any. */
  firmware: MockFirmware | null = null;
  private firmwareListeners = new Set<() => void>();

  async availability() {
    return null;
  }

  async ensureReady() {
    return null;
  }

  onFirmwareChange(listener: () => void): () => void {
    this.firmwareListeners.add(listener);
    return () => this.firmwareListeners.delete(listener);
  }

  setBehavior(behavior: MockBehavior) {
    this.behavior = behavior;
    if (this.firmware) this.firmware.behavior = behavior;
  }

  scan(onDevice: Parameters<DeviceDriver['scan']>[0]): ScanHandle {
    const t = setTimeout(
      () => onDevice({ id: MOCK_DEVICE_ID, name: MOCK_DEVICE_NAME, rssi: null, likelyBoard: true }),
      300,
    );
    return { stop: () => clearTimeout(t) };
  }

  async connect(): Promise<DeviceLink> {
    await new Promise((r) => setTimeout(r, 400));
    const receivers = new Set<(bytes: Uint8Array) => void>();
    let connected = true;
    const firmware = new MockFirmware({ rows: GRID.rows, cols: GRID.cols, behavior: this.behavior }, (bytes) => {
      if (connected) receivers.forEach((r) => r(bytes));
    });
    this.firmware = firmware;
    const unsubFirmware = firmware.subscribe(() => this.firmwareListeners.forEach((l) => l()));
    this.firmwareListeners.forEach((l) => l());

    const transport: Transport = {
      maxWriteSize: maxWriteSizeForMtu(DEFAULT_MTU),
      async write(bytes) {
        if (!connected) throw new Error('Mock device is disconnected');
        if (bytes.length > transport.maxWriteSize) throw new Error('Write larger than MTU');
        await new Promise((r) => setTimeout(r, 15));
        firmware.receiveChunk(bytes);
      },
      onReceive(listener) {
        receivers.add(listener);
        return () => receivers.delete(listener);
      },
    };

    return {
      id: MOCK_DEVICE_ID,
      name: MOCK_DEVICE_NAME,
      mtu: DEFAULT_MTU,
      transport,
      disconnect: async () => {
        connected = false;
        unsubFirmware();
        if (this.firmware === firmware) this.firmware = null;
        this.firmwareListeners.forEach((l) => l());
      },
      onUnexpectedDisconnect: () => () => {},
    };
  }
}
