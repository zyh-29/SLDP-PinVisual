/**
 * The device interface the Bluetooth implementations (native and web) share.
 * UI code only talks to DeviceController, which only talks to these types.
 */

/** Raw byte pipe to a connected board. */
export interface Transport {
  /** Largest single write the link accepts (MTU minus ATT overhead). */
  readonly maxWriteSize: number;
  /** Resolves when the link layer accepted the write. That is NOT an app-level acknowledgement. */
  write(bytes: Uint8Array): Promise<void>;
  /** Subscribe to bytes the board sends back (one notification per call). */
  onReceive(listener: (bytes: Uint8Array) => void): () => void;
}

export interface DiscoveredDevice {
  id: string;
  name: string;
  rssi: number | null;
  /** True when the name prefix or advertised service suggests a PinVisual board. */
  likelyBoard: boolean;
}

export interface DeviceLink {
  readonly id: string;
  readonly name: string;
  readonly mtu: number;
  readonly transport: Transport;
  disconnect(): Promise<void>;
  /** Called once if the link drops without disconnect() being called. */
  onUnexpectedDisconnect(listener: (reason: string) => void): () => void;
}

export interface ScanHandle {
  stop(): void;
}

export interface DeviceDriver {
  /**
   * True when the OS/browser shows its own device chooser (Web Bluetooth).
   * The controller then connects to the chosen device straight away.
   */
  readonly selectsWithSystemPicker?: boolean;
  /** Null when usable, otherwise a human readable reason (e.g. running in Expo Go). */
  availability(): Promise<string | null>;
  /** Ask for OS permissions. Resolves to null on success or an error message. */
  ensureReady(): Promise<string | null>;
  scan(
    onDevice: (device: DiscoveredDevice) => void,
    onError: (message: string) => void,
    options: { showAllDevices: boolean },
  ): ScanHandle;
  connect(deviceId: string, name: string): Promise<DeviceLink>;
}
