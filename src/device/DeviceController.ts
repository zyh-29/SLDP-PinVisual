import type { Pattern } from '@/domain/pattern';
import { CommandClient, type CommandProgress, type CommandResult } from '@/protocol/CommandClient';
import type { Command } from '@/protocol/messages';
import type { DeviceDriver, DeviceLink, DiscoveredDevice, ScanHandle } from './types';

export type ConnectionState =
  | { status: 'disconnected'; error?: string }
  | { status: 'connecting'; deviceName: string }
  | { status: 'connected'; deviceName: string; deviceId: string; mtu: number; maxWriteSize: number };

export type CommandKind = Command['kind'];

export type CommandState =
  | { status: 'idle' }
  | { status: 'sending'; kind: CommandKind; progress: CommandProgress | null }
  | { status: 'succeeded'; kind: CommandKind; commandId: number; attempts: number; at: number }
  | { status: 'failed'; kind: CommandKind; message: string; at: number };

export interface DeviceSnapshot {
  connection: ConnectionState;
  command: CommandState;
  scanning: boolean;
  scanError: string | null;
  discovered: DiscoveredDevice[];
  /** Pattern the board acknowledged most recently (null after reset / disconnect). */
  lastAcknowledgedPattern: Pattern | null;
}

/**
 * Framework-agnostic controller for one board. React subscribes through
 * useSyncExternalStore (see src/state/DeviceProvider.tsx).
 */
export class DeviceController {
  private snapshot: DeviceSnapshot;
  private listeners = new Set<() => void>();
  private link: DeviceLink | null = null;
  private client: CommandClient | null = null;
  private scanHandle: ScanHandle | null = null;
  private scanTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubDisconnect: (() => void) | null = null;
  private connectAttempt = 0;

  constructor(
    /** The board connection (Bluetooth: react-native-ble-plx on phones, Web Bluetooth in browsers). */
    readonly driver: DeviceDriver,
    private readonly scanDurationMs = 15_000,
  ) {
    this.snapshot = {
      connection: { status: 'disconnected' },
      command: { status: 'idle' },
      scanning: false,
      scanError: null,
      discovered: [],
      lastAcknowledgedPattern: null,
    };
  }

  // ---- store plumbing ----
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;

  private set(patch: Partial<DeviceSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((l) => l());
  }

  get isBusy(): boolean {
    return this.snapshot.command.status === 'sending';
  }

  // ---- scanning ----
  async startScan(options: { showAllDevices: boolean } = { showAllDevices: false }) {
    this.stopScan();
    this.set({ discovered: [], scanError: null });
    const driver = this.driver;
    const unavailable = (await driver.availability()) ?? (await driver.ensureReady());
    if (unavailable) {
      this.set({ scanError: unavailable });
      return;
    }
    this.set({ scanning: true });
    this.scanHandle = driver.scan(
      (device) => {
        if (driver.selectsWithSystemPicker) {
          // The user already chose this device in the browser's picker.
          this.stopScan();
          this.set({ discovered: [device] });
          void this.connect(device);
          return;
        }
        const others = this.snapshot.discovered.filter((d) => d.id !== device.id);
        const discovered = [...others, device].sort(
          (a, b) => Number(b.likelyBoard) - Number(a.likelyBoard) || (b.rssi ?? -999) - (a.rssi ?? -999),
        );
        this.set({ discovered });
      },
      (message) => {
        this.stopScan();
        this.set({ scanError: message });
      },
      options,
    );
    this.scanTimer = setTimeout(() => this.stopScan(), this.scanDurationMs);
  }

  stopScan() {
    if (this.scanTimer) clearTimeout(this.scanTimer);
    this.scanTimer = null;
    this.scanHandle?.stop();
    this.scanHandle = null;
    if (this.snapshot.scanning) this.set({ scanning: false });
  }

  // ---- connection ----
  async connect(device: { id: string; name: string }) {
    if (this.snapshot.connection.status === 'connecting' || this.isBusy) return;
    this.stopScan();
    await this.disconnect();
    const attempt = ++this.connectAttempt;
    this.set({ connection: { status: 'connecting', deviceName: device.name } });
    try {
      const ready = (await this.driver.availability()) ?? (await this.driver.ensureReady());
      if (ready) throw new Error(ready);
      const link = await this.driver.connect(device.id, device.name);
      if (attempt !== this.connectAttempt) {
        await link.disconnect();
        return;
      }
      this.link = link;
      this.client = new CommandClient(link.transport);
      this.unsubDisconnect = link.onUnexpectedDisconnect((reason) => this.handleLinkLost(reason));
      this.set({
        connection: {
          status: 'connected',
          deviceName: link.name,
          deviceId: link.id,
          mtu: link.mtu,
          maxWriteSize: link.transport.maxWriteSize,
        },
        command: { status: 'idle' },
        lastAcknowledgedPattern: null,
      });
    } catch (e) {
      if (attempt !== this.connectAttempt) return;
      this.set({ connection: { status: 'disconnected', error: `Could not connect: ${errorText(e)}` } });
    }
  }

  async disconnect() {
    this.connectAttempt++;
    const link = this.link;
    this.teardownLink();
    if (link) await link.disconnect().catch(() => {});
    if (this.snapshot.connection.status !== 'disconnected' || this.snapshot.connection.error) {
      this.set({ connection: { status: 'disconnected' }, lastAcknowledgedPattern: null });
    }
  }

  private teardownLink() {
    this.unsubDisconnect?.();
    this.unsubDisconnect = null;
    this.link = null;
    this.client = null;
  }

  private handleLinkLost(reason: string) {
    this.teardownLink();
    const command: CommandState =
      this.snapshot.command.status === 'sending'
        ? { status: 'failed', kind: this.snapshot.command.kind, message: `Connection lost: ${reason}`, at: Date.now() }
        : this.snapshot.command;
    this.set({ connection: { status: 'disconnected', error: `Connection lost: ${reason}` }, command, lastAcknowledgedPattern: null });
  }

  // ---- commands ----
  sendPattern(pattern: Pattern): Promise<CommandResult> {
    return this.run({ kind: 'pattern', pattern });
  }

  /** Sends the documented RESET command (board lowers every pin). */
  reset(): Promise<CommandResult> {
    return this.run({ kind: 'reset' });
  }

  clearCommandStatus() {
    if (!this.isBusy) this.set({ command: { status: 'idle' } });
  }

  private async run(command: Command): Promise<CommandResult> {
    const client = this.client;
    const link = this.link;
    if (this.isBusy || client?.busy) {
      return { ok: false, commandId: null, attempts: 0, failure: 'busy', message: 'Another command is still in progress.' };
    }
    if (!client || !link || this.snapshot.connection.status !== 'connected') {
      const message = 'No board connected. Connect to the board on the Device tab first.';
      this.set({ command: { status: 'failed', kind: command.kind, message, at: Date.now() } });
      return { ok: false, commandId: null, attempts: 0, failure: 'invalid', message };
    }

    this.set({ command: { status: 'sending', kind: command.kind, progress: null } });
    const result = await client.send(command, (progress) => {
      if (this.client === client) this.set({ command: { status: 'sending', kind: command.kind, progress } });
    });

    // The link may have dropped (and set a failure) while we waited.
    if (this.client !== client) return result;

    if (result.ok) {
      this.set({
        command: {
          status: 'succeeded',
          kind: command.kind,
          commandId: result.commandId,
          attempts: result.attempts,
          at: Date.now(),
        },
        lastAcknowledgedPattern: command.kind === 'pattern' ? command.pattern : null,
      });
    } else {
      this.set({ command: { status: 'failed', kind: command.kind, message: result.message, at: Date.now() } });
    }
    return result;
  }
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
