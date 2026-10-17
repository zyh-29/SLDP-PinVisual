/**
 * Web Bluetooth driver, used automatically in the browser instead of
 * BleDriver.ts (react-native-ble-plx has no web support).
 *
 * Works in Chrome and Edge on desktop and Android, on https:// or localhost.
 * Safari, Firefox and every iOS browser have no Web Bluetooth. They get a
 * clear message, and mock mode still works.
 *
 * NOT VERIFIED AGAINST HARDWARE.
 */
import { BLE } from '@/config/hardware';
import { DEFAULT_MTU, maxWriteSizeForMtu } from '@/protocol/chunking';
import type { DeviceDriver, DeviceLink, DiscoveredDevice, ScanHandle, Transport } from '../types';

// Minimal Web Bluetooth typings (not part of TypeScript's DOM lib).
interface WbCharacteristic extends EventTarget {
  readonly value: DataView | null;
  readonly properties: { write: boolean; notify: boolean };
  writeValueWithResponse(value: BufferSource): Promise<void>;
  startNotifications(): Promise<WbCharacteristic>;
  stopNotifications(): Promise<WbCharacteristic>;
}
interface WbService {
  getCharacteristic(uuid: string): Promise<WbCharacteristic>;
}
interface WbServer {
  readonly connected: boolean;
  connect(): Promise<WbServer>;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<WbService>;
}
interface WbDevice extends EventTarget {
  readonly id: string;
  readonly name?: string;
  readonly gatt?: WbServer;
}
interface WbRequestOptions {
  filters?: ({ namePrefix: string } | { services: string[] })[];
  acceptAllDevices?: boolean;
  optionalServices?: string[];
}
interface WbBluetooth {
  getAvailability(): Promise<boolean>;
  requestDevice(options: WbRequestOptions): Promise<WbDevice>;
}

function bluetooth(): WbBluetooth | null {
  if (typeof navigator === 'undefined') return null;
  return (navigator as Navigator & { bluetooth?: WbBluetooth }).bluetooth ?? null;
}

const UNSUPPORTED =
  'This browser cannot use Bluetooth. Use Chrome or Edge on a laptop or Android phone, or the mobile app. Mock mode works in every browser.';

function errorText(e: unknown): string {
  if (e instanceof DOMException && e.name === 'NotFoundError') return 'No board was chosen.';
  if (e instanceof DOMException && e.name === 'SecurityError') return 'Bluetooth needs a secure page (https:// or localhost).';
  return e instanceof Error ? e.message : String(e);
}

const withTimeout = <T>(p: Promise<T>, ms: number, what: string) =>
  Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${what} timed out`)), ms))]);

export class BleDriver implements DeviceDriver {
  readonly kind = 'ble' as const;
  readonly selectsWithSystemPicker = true;
  /** Devices the user picked this session, by id (Web Bluetooth cannot look them up later). */
  private picked = new Map<string, WbDevice>();

  async availability(): Promise<string | null> {
    const bt = bluetooth();
    if (!bt) return UNSUPPORTED;
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      return 'Bluetooth needs a secure page (https:// or localhost).';
    }
    try {
      if (!(await bt.getAvailability())) return 'No Bluetooth adapter is available, or Bluetooth is turned off.';
    } catch {
      // Some browsers lack getAvailability; requestDevice will report problems.
    }
    return null;
  }

  async ensureReady(): Promise<string | null> {
    return null; // The browser asks for permission in its device picker.
  }

  /** Opens the browser's device picker. Must run from a click (user gesture). */
  scan(onDevice: (d: DiscoveredDevice) => void, onError: (m: string) => void, options: { showAllDevices: boolean }): ScanHandle {
    const bt = bluetooth();
    if (!bt) {
      onError(UNSUPPORTED);
      return { stop() {} };
    }
    let cancelled = false;
    const request: WbRequestOptions = options.showAllDevices
      ? { acceptAllDevices: true, optionalServices: [BLE.serviceUUID] }
      : {
          filters: [{ namePrefix: BLE.deviceNamePrefix }, { services: [BLE.serviceUUID] }],
          optionalServices: [BLE.serviceUUID],
        };
    bt.requestDevice(request).then(
      (device) => {
        if (cancelled) return;
        this.picked.set(device.id, device);
        const name = device.name ?? 'Unnamed device';
        onDevice({ id: device.id, name, rssi: null, likelyBoard: name.startsWith(BLE.deviceNamePrefix) });
      },
      (e: unknown) => {
        if (!cancelled) onError(errorText(e));
      },
    );
    return {
      stop() {
        cancelled = true;
      },
    };
  }

  async connect(deviceId: string, name: string): Promise<DeviceLink> {
    const device = this.picked.get(deviceId);
    if (!device?.gatt) throw new Error('Choose the board again from the browser’s device list.');

    const server = await withTimeout(device.gatt.connect(), BLE.connectTimeoutMs, 'Connecting');
    let command: WbCharacteristic;
    let ack: WbCharacteristic;
    try {
      const service = await server.getPrimaryService(BLE.serviceUUID).catch(() => {
        throw new Error(
          BLE.uuidsArePlaceholders
            ? 'This device does not expose the PinVisual service. The app is still using placeholder UUIDs - update src/config/hardware.ts to match the firmware.'
            : 'This device does not expose the PinVisual service.',
        );
      });
      command = await service.getCharacteristic(BLE.commandCharacteristicUUID);
      ack = await service.getCharacteristic(BLE.ackCharacteristicUUID);
      if (!command.properties.write) throw new Error('Command characteristic is not writable with response.');
      if (!ack.properties.notify) throw new Error('Acknowledgement characteristic does not support notifications.');
      await ack.startNotifications();
    } catch (e) {
      server.disconnect();
      throw e;
    }

    const receivers = new Set<(bytes: Uint8Array) => void>();
    const disconnectListeners = new Set<(reason: string) => void>();
    let intentional = false;

    const onValue = (event: Event) => {
      const value = (event.target as unknown as WbCharacteristic).value;
      if (!value) return;
      const bytes = new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
      receivers.forEach((r) => r(bytes));
    };
    const onDisconnected = () => {
      ack.removeEventListener('characteristicvaluechanged', onValue);
      device.removeEventListener('gattserverdisconnected', onDisconnected);
      if (!intentional) disconnectListeners.forEach((l) => l('The board disconnected.'));
    };
    ack.addEventListener('characteristicvaluechanged', onValue);
    device.addEventListener('gattserverdisconnected', onDisconnected);

    // Web Bluetooth does not report the negotiated MTU, so assume the BLE
    // default (20-byte writes). Chunking keeps every write within that.
    const transport: Transport = {
      maxWriteSize: maxWriteSizeForMtu(DEFAULT_MTU),
      async write(bytes) {
        if (!server.connected) throw new Error('Board is not connected.');
        await command.writeValueWithResponse(bytes.slice());
      },
      onReceive(listener) {
        receivers.add(listener);
        return () => receivers.delete(listener);
      },
    };

    return {
      id: deviceId,
      name: device.name ?? name,
      isMock: false,
      mtu: DEFAULT_MTU,
      transport,
      async disconnect() {
        intentional = true;
        await ack.stopNotifications().catch(() => {});
        onDisconnected();
        server.disconnect();
      },
      onUnexpectedDisconnect(listener) {
        disconnectListeners.add(listener);
        return () => disconnectListeners.delete(listener);
      },
    };
  }
}
