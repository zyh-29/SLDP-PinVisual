import { createContext, type ReactNode, useContext, useSyncExternalStore } from 'react';

import { BleDriver } from '@/device/ble/BleDriver';
import { DeviceController, type DeviceSnapshot } from '@/device/DeviceController';
import { MockDriver } from '@/device/mock/MockDriver';
import { BLE } from '@/config/hardware';

// One controller for the app's lifetime so a connection survives tab changes.
const mockDriver = new MockDriver();
const controller = new DeviceController({ ble: new BleDriver(), mock: mockDriver }, 'ble', BLE.scanTimeoutMs);

const DeviceContext = createContext<{ controller: DeviceController; mock: MockDriver }>({ controller, mock: mockDriver });

export function DeviceProvider({ children }: { children: ReactNode }) {
  return <DeviceContext.Provider value={{ controller, mock: mockDriver }}>{children}</DeviceContext.Provider>;
}

export function useDevice(): { state: DeviceSnapshot; controller: DeviceController; mock: MockDriver } {
  const ctx = useContext(DeviceContext);
  const state = useSyncExternalStore(ctx.controller.subscribe, ctx.controller.getSnapshot);
  return { state, controller: ctx.controller, mock: ctx.mock };
}
