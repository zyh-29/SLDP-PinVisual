import { createContext, type ReactNode, useContext, useSyncExternalStore } from 'react';

import { BleDriver } from '@/device/ble/BleDriver';
import { DeviceController, type DeviceSnapshot } from '@/device/DeviceController';
import { BLE } from '@/config/hardware';

// One controller for the app's lifetime so a connection survives tab changes.
const controller = new DeviceController(new BleDriver(), BLE.scanTimeoutMs);

const DeviceContext = createContext<{ controller: DeviceController }>({ controller });

export function DeviceProvider({ children }: { children: ReactNode }) {
  return <DeviceContext.Provider value={{ controller }}>{children}</DeviceContext.Provider>;
}

export function useDevice(): { state: DeviceSnapshot; controller: DeviceController } {
  const ctx = useContext(DeviceContext);
  const state = useSyncExternalStore(ctx.controller.subscribe, ctx.controller.getSnapshot);
  return { state, controller: ctx.controller };
}
