/**
 * Real Bluetooth Low Energy driver (react-native-ble-plx).
 *
 * NOT VERIFIED AGAINST HARDWARE: written against the ble-plx 3.5 API and the
 * protocol in docs/PROTOCOL.md. It needs an Expo development build and a
 * physical phone; it cannot run in Expo Go or a simulator.
 */
import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import type { BleManager, Device, Subscription } from 'react-native-ble-plx';

import { BLE } from '@/config/hardware';
import { base64ToBytes, bytesToBase64 } from '@/protocol/base64';
import { maxWriteSizeForMtu } from '@/protocol/chunking';
import type { DeviceDriver, DeviceLink, DiscoveredDevice, ScanHandle, Transport } from '../types';

let manager: BleManager | null = null;

function getManager(): BleManager | null {
  if (manager) return manager;
  // The native module is missing in Expo Go and on web. Check before touching
  // the library so the app can explain instead of crashing.
  if (Platform.OS === 'web' || !NativeModules.BlePlx) return null;
  try {
    // Lazy require: importing eagerly would touch the missing native module in Expo Go.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { BleManager: Manager } = require('react-native-ble-plx') as typeof import('react-native-ble-plx');
    manager = new Manager();
    return manager;
  } catch {
    return null;
  }
}

const sameUuid = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function errorText(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return String(e);
}

async function requestAndroidPermissions(): Promise<string | null> {
  if (Platform.OS !== 'android') return null;
  const apiLevel = typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version), 10);
  const P = PermissionsAndroid.PERMISSIONS;
  const needed =
    apiLevel >= 31 ? [P.BLUETOOTH_SCAN, P.BLUETOOTH_CONNECT] : [P.ACCESS_FINE_LOCATION];
  const result = await PermissionsAndroid.requestMultiple(needed);
  const denied = needed.filter((p) => result[p] !== PermissionsAndroid.RESULTS.GRANTED);
  if (denied.length === 0) return null;
  return apiLevel >= 31
    ? 'Bluetooth permission was denied. Allow "Nearby devices" for this app in Settings.'
    : 'Location permission is required for Bluetooth scanning on this Android version.';
}

async function waitForPoweredOn(m: BleManager, timeoutMs = 4000): Promise<string | null> {
  const describe = (state: string) => {
    switch (state) {
      case 'PoweredOn':
        return null;
      case 'PoweredOff':
        return 'Bluetooth is turned off. Turn it on in Settings or Control Center.';
      case 'Unauthorized':
        return 'This app is not allowed to use Bluetooth. Enable it in Settings.';
      case 'Unsupported':
        return 'This phone does not support Bluetooth Low Energy.';
      default:
        return `Bluetooth is not ready (${state}).`;
    }
  };
  const current = await m.state();
  if (current === 'PoweredOn') return null;
  if (current === 'PoweredOff' || current === 'Unauthorized' || current === 'Unsupported') return describe(current);
  // 'Unknown' / 'Resetting' are transient at start-up: wait briefly.
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      sub.remove();
      m.state().then((s) => resolve(describe(s)));
    }, timeoutMs);
    const sub = m.onStateChange((s) => {
      if (s === 'PoweredOn' || s === 'PoweredOff' || s === 'Unauthorized' || s === 'Unsupported') {
        clearTimeout(timer);
        sub.remove();
        resolve(describe(s));
      }
    }, true);
  });
}

export class BleDriver implements DeviceDriver {
  readonly kind = 'ble' as const;

  async availability(): Promise<string | null> {
    if (Platform.OS === 'web') return 'Bluetooth is not available on web.';
    if (!getManager()) {
      return 'Bluetooth needs the development build. It is not available in Expo Go - use Mock mode there.';
    }
    return null;
  }

  async ensureReady(): Promise<string | null> {
    const m = getManager();
    if (!m) return (await this.availability()) ?? 'Bluetooth unavailable.';
    const permissionError = await requestAndroidPermissions();
    if (permissionError) return permissionError;
    // On iOS the system permission prompt appears when the manager is created.
    return waitForPoweredOn(m);
  }

  scan(
    onDevice: (device: DiscoveredDevice) => void,
    onError: (message: string) => void,
    options: { showAllDevices: boolean },
  ): ScanHandle {
    const m = getManager();
    if (!m) {
      onError('Bluetooth unavailable.');
      return { stop() {} };
    }
    let stopped = false;
    // Scan without a service filter: while the UUIDs are placeholders a filter
    // would hide the board. Filtering happens below instead.
    m.startDeviceScan(null, { allowDuplicates: false }, (error, device) => {
      if (stopped) return;
      if (error) {
        onError(errorText(error));
        return;
      }
      if (!device) return;
      const name = device.name ?? device.localName ?? '';
      const advertisesService = (device.serviceUUIDs ?? []).some((u) => sameUuid(u, BLE.serviceUUID));
      const likelyBoard = advertisesService || name.startsWith(BLE.deviceNamePrefix);
      if (!likelyBoard && (!options.showAllDevices || !name)) return;
      onDevice({ id: device.id, name: name || 'Unnamed device', rssi: device.rssi, likelyBoard });
    }).catch((e: unknown) => onError(errorText(e)));
    const timer = setTimeout(() => handle.stop(), BLE.scanTimeoutMs);
    const handle = {
      stop() {
        if (stopped) return;
        stopped = true;
        clearTimeout(timer);
        m.stopDeviceScan().catch(() => {});
      },
    };
    return handle;
  }

  async connect(deviceId: string, name: string): Promise<DeviceLink> {
    const m = getManager();
    if (!m) throw new Error('Bluetooth unavailable.');

    let device: Device = await m.connectToDevice(deviceId, {
      timeout: BLE.connectTimeoutMs,
      ...(Platform.OS === 'android' ? { requestMTU: BLE.requestedMtu } : {}),
    });
    try {
      device = await device.discoverAllServicesAndCharacteristics();
      const services = await device.services();
      const service = services.find((s) => sameUuid(s.uuid, BLE.serviceUUID));
      if (!service) {
        throw new Error(
          BLE.uuidsArePlaceholders
            ? 'This device does not expose the PinVisual service. The app is still using placeholder UUIDs - update src/config/hardware.ts to match the firmware.'
            : 'This device does not expose the PinVisual service.',
        );
      }
      const characteristics = await service.characteristics();
      const command = characteristics.find((c) => sameUuid(c.uuid, BLE.commandCharacteristicUUID));
      const ack = characteristics.find((c) => sameUuid(c.uuid, BLE.ackCharacteristicUUID));
      if (!command || !command.isWritableWithResponse) {
        throw new Error('Command characteristic missing or not writable with response.');
      }
      if (!ack || !ack.isNotifiable) {
        throw new Error('Acknowledgement characteristic missing or does not support notifications.');
      }
    } catch (e) {
      await m.cancelDeviceConnection(deviceId).catch(() => {});
      throw e;
    }

    const mtu = device.mtu || 23;
    const receivers = new Set<(bytes: Uint8Array) => void>();
    const disconnectListeners = new Set<(reason: string) => void>();
    let intentionalDisconnect = false;
    let ackError: string | null = null;

    const monitor: Subscription = m.monitorCharacteristicForDevice(
      deviceId,
      BLE.serviceUUID,
      BLE.ackCharacteristicUUID,
      (error, characteristic) => {
        if (error) {
          ackError = errorText(error);
          return;
        }
        if (!characteristic?.value) return;
        try {
          const bytes = base64ToBytes(characteristic.value);
          receivers.forEach((r) => r(bytes));
        } catch {
          // Malformed notification: ignore, CommandClient will time out and retry.
        }
      },
    );

    const disconnectSub = m.onDeviceDisconnected(deviceId, (error) => {
      monitor.remove();
      disconnectSub.remove();
      if (intentionalDisconnect) return;
      const reason = error ? errorText(error) : 'The board disconnected.';
      disconnectListeners.forEach((l) => l(reason));
    });

    const transport: Transport = {
      maxWriteSize: maxWriteSizeForMtu(mtu),
      async write(bytes) {
        if (ackError) throw new Error(`Acknowledgement channel failed: ${ackError}`);
        await m.writeCharacteristicWithResponseForDevice(
          deviceId,
          BLE.serviceUUID,
          BLE.commandCharacteristicUUID,
          bytesToBase64(bytes),
        );
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
      mtu,
      transport,
      async disconnect() {
        intentionalDisconnect = true;
        monitor.remove();
        disconnectSub.remove();
        await m.cancelDeviceConnection(deviceId).catch(() => {});
      },
      onUnexpectedDisconnect(listener) {
        disconnectListeners.add(listener);
        return () => disconnectListeners.delete(listener);
      },
    };
  }
}
