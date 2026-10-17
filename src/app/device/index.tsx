import { useEffect, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Switch, View } from 'react-native';

import { BLE, GRID, PROTOCOL } from '@/config/hardware';
import type { DeviceMode } from '@/device/DeviceController';
import type { MockBehavior } from '@/device/mock/MockFirmware';
import { MOCK_DEVICE_ID, MOCK_DEVICE_NAME } from '@/device/mock/MockDriver';
import { createEmptyPattern } from '@/domain/pattern';
import { useDevice } from '@/state/DeviceProvider';
import { useBoardActions } from '@/state/useBoardActions';
import { CommandStatus } from '@/ui/CommandStatus';
import { Button, Columns, Label, Row, Screen, Section, SegmentedControl, Separator, StatusBanner } from '@/ui/components';
import { connectionSummary } from '@/ui/ConnectionPill';
import { Icon } from '@/ui/Icon';
import { PinGrid } from '@/ui/PinGrid';
import { space, useTheme } from '@/ui/theme';

const BEHAVIORS: { value: MockBehavior; label: string; detail: string }[] = [
  { value: 'normal', label: 'Normal', detail: 'Acknowledges quickly.' },
  { value: 'slow', label: 'Slow', detail: 'Acknowledges after 1.5 s.' },
  { value: 'drop_first_ack', label: 'Lossy', detail: 'Ignores the first attempt, so the app retries.' },
  { value: 'never_ack', label: 'Silent', detail: 'Never answers. The command times out.' },
  { value: 'reject', label: 'Faulty', detail: 'Answers with a hardware fault error.' },
];

export default function DeviceScreen() {
  const t = useTheme();
  const { state, controller, mock } = useDevice();
  const { send, reset, connected, busy, isMock } = useBoardActions();
  const [showAll, setShowAll] = useState(false);
  const [behavior, setBehavior] = useState<MockBehavior>(mock.behavior);

  const c = state.connection;
  const summary = connectionSummary(c);

  useEffect(() => () => controller.stopScan(), [controller]);

  // Browsers without Web Bluetooth (Safari, Firefox, iOS) get told up front.
  const [bleUnavailable, setBleUnavailable] = useState<string | null>(null);
  useEffect(() => {
    if (Platform.OS !== 'web' || state.mode !== 'ble') return;
    let live = true;
    controller.driver.availability().then((reason) => live && setBleUnavailable(reason));
    return () => {
      live = false;
    };
  }, [controller, state.mode]);
  const picker = !!controller.driver.selectsWithSystemPicker;

  const setMode = (m: DeviceMode) => controller.setMode(m);

  return (
    <Screen title="Device">
      <Columns
        left={
          <>
      <SegmentedControl
        accessibilityLabel="Connection mode"
        value={state.mode}
        onChange={setMode}
        disabled={busy}
        options={[
          { value: 'ble', label: 'Bluetooth' },
          { value: 'mock', label: 'Mock Device' },
        ]}
      />

      {/* Connection status */}
      <Section title="Status">
        <View style={styles.statusRow} accessible accessibilityLabel={summary.long}>
          <View style={[styles.statusIcon, { backgroundColor: summary.kind === 'mock' ? t.warningSoft : summary.kind === 'real' ? t.successSoft : t.fill }]}>
            {summary.kind === 'busy' ? (
              <ActivityIndicator color={t.tint} />
            ) : (
              <Icon
                name={summary.kind === 'mock' ? 'mock' : summary.kind === 'real' ? 'connected' : 'disconnected'}
                color={summary.kind === 'mock' ? t.warning : summary.kind === 'real' ? t.success : t.textSecondary}
                size={22}
              />
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Label variant="headline">{summary.short}</Label>
            <Label variant="footnote" secondary>
              {c.status === 'connected'
                ? c.isMock
                  ? 'Simulated board. No hardware is connected.'
                  : `${c.deviceName} · MTU ${c.mtu} · ${c.maxWriteSize}-byte writes`
                : c.status === 'connecting'
                  ? c.deviceName
                  : state.mode === 'mock'
                    ? 'Mock device available for testing'
                    : 'Scan to find your board'}
            </Label>
          </View>
        </View>
        {c.status === 'disconnected' && c.error ? <StatusBanner tone="error" title="Connection problem" message={c.error} /> : null}
        {c.status === 'connected' ? (
          <Button title="Disconnect" variant="secondary" compact onPress={() => controller.disconnect()} disabled={busy} />
        ) : null}
      </Section>

      {state.mode === 'ble' ? (
        <>
          {bleUnavailable ? <StatusBanner tone="warning" title="Bluetooth not available here" message={bleUnavailable} /> : null}
          {BLE.uuidsArePlaceholders ? (
            <StatusBanner
              tone="warning"
              title="Placeholder Bluetooth IDs"
              message="The service and characteristic UUIDs are placeholders until the ESP32 firmware defines them. Update src/config/hardware.ts to connect to a real board."
            />
          ) : null}

          {c.status !== 'connected' ? (
            <Section
              title="Nearby boards"
              padded={false}
              footer={
                picker
                  ? `Your browser shows its own device list. It offers boards named "${BLE.deviceNamePrefix}…" or advertising the PinVisual service, and connects to the one you choose.`
                  : `Boards named "${BLE.deviceNamePrefix}…" or advertising the PinVisual service are listed first.`
              }>
              <View style={styles.scanControls}>
                <Button
                  title={picker ? 'Choose Board…' : state.scanning ? 'Stop Scanning' : 'Scan for Boards'}
                  icon={state.scanning ? undefined : 'bluetooth'}
                  variant={state.scanning ? 'secondary' : 'primary'}
                  onPress={() =>
                    state.scanning && !picker ? controller.stopScan() : controller.startScan({ showAllDevices: showAll })
                  }
                  disabled={c.status === 'connecting' || !!bleUnavailable}
                />
                <View style={styles.switchRow}>
                  <Label variant="body" style={{ flex: 1 }}>
                    {picker ? 'Show every device in the list' : 'Show all named devices'}
                  </Label>
                  <Switch value={showAll} onValueChange={setShowAll} accessibilityLabel="Show all named Bluetooth devices" />
                </View>
              </View>
              {state.scanError ? (
                <View style={{ paddingHorizontal: space.lg, paddingBottom: space.lg }}>
                  <StatusBanner tone="error" title="Bluetooth unavailable" message={state.scanError} />
                </View>
              ) : null}
              {state.scanning && state.discovered.length === 0 ? (
                <View style={styles.scanning}>
                  <ActivityIndicator />
                  <Label variant="subhead" secondary>
                    {picker ? 'Waiting for you to choose a board…' : 'Scanning…'}
                  </Label>
                </View>
              ) : null}
              {state.discovered.map((d) => (
                <View key={d.id}>
                  <Separator inset={space.lg} />
                  <Row
                    title={d.name}
                    detail={[d.likelyBoard ? 'Likely PinVisual board' : 'Other device', d.rssi != null ? `Signal ${d.rssi} dBm` : null]
                      .filter(Boolean)
                      .join(' · ')}
                    onPress={() => controller.connect(d)}
                    accessibilityHint="Connects to this device"
                    right={<Icon name="chevron" color={t.textSecondary} size={16} />}
                  />
                </View>
              ))}
            </Section>
          ) : null}
        </>
      ) : (
        <>
          <StatusBanner
            tone="warning"
            title="Mock mode: no hardware"
            message="Commands go to a simulated board running the same protocol. Acknowledgements are simulated."
          />
          {c.status !== 'connected' ? (
            <Button
              title="Connect Mock Device"
              icon="mock"
              onPress={() => controller.connect({ id: MOCK_DEVICE_ID, name: MOCK_DEVICE_NAME })}
              loading={c.status === 'connecting'}
            />
          ) : null}
          <Section title="Simulated behaviour" footer={BEHAVIORS.find((b) => b.value === behavior)?.detail}>
            <SegmentedControl
              accessibilityLabel="Simulated board behaviour"
              value={behavior}
              onChange={(b) => {
                setBehavior(b);
                mock.setBehavior(b);
              }}
              options={BEHAVIORS.map(({ value, label }) => ({ value, label }))}
            />
          </Section>
          <MockBoardState />
        </>
      )}
          </>
        }
        right={
          <>
      <View style={{ gap: space.md }}>
        <CommandStatus command={state.command} connected={connected} onRetrySend={send} onRetryReset={reset} />
        <Button
          title="Reset Physical Pins"
          icon="reset"
          variant="destructive"
          onPress={reset}
          disabled={!connected || busy}
          loading={busy && state.command.status === 'sending' && state.command.kind === 'reset'}
          accessibilityHint={connected ? 'Tells the board to lower every pin.' : 'Unavailable: no board connected.'}
        />
        {!connected ? (
          <Label variant="footnote" secondary style={{ marginHorizontal: space.lg }}>
            Reset needs a connected {state.mode === 'mock' ? 'mock device' : 'board'}.
          </Label>
        ) : isMock ? (
          <Label variant="footnote" secondary style={{ marginHorizontal: space.lg }}>
            In mock mode, reset only affects the simulated board.
          </Label>
        ) : null}
      </View>

      <Section title="Protocol" padded={false}>
        <Row title="Grid" detail={`${GRID.rows} rows × ${GRID.cols} columns (provisional)`} />
        <Separator inset={space.lg} />
        <Row title="Protocol version" detail={`v${PROTOCOL.version} · ack timeout ${PROTOCOL.ackTimeoutMs / 1000} s · ${PROTOCOL.maxAttempts} attempts`} />
        <Separator inset={space.lg} />
        <Row title="Service UUID" detail={`${BLE.serviceUUID}${BLE.uuidsArePlaceholders ? ' (placeholder)' : ''}`} />
      </Section>
          </>
        }
      />
    </Screen>
  );
}

/** Shows the simulated board's pin state, clearly labelled as simulated. */
function MockBoardState() {
  const { mock } = useDevice();
  const pins = useSyncExternalStore(
    (cb) => mock.onFirmwareChange(cb),
    () => mock.firmware?.simulatedPins ?? null,
  );
  return (
    <Section title="Simulated board pins" footer="What the mock firmware would have told the servos. Not real hardware.">
      {pins ? <PinGrid pattern={pins} /> : <PinGrid pattern={EMPTY} />}
      {!pins ? (
        <Label variant="footnote" secondary>
          Connect the mock device to see its state.
        </Label>
      ) : null}
    </Section>
  );
}

const EMPTY = createEmptyPattern(GRID.rows, GRID.cols);

const styles = StyleSheet.create({
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  statusIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  scanControls: { padding: space.lg, gap: space.md },
  switchRow: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  scanning: { flexDirection: 'row', gap: space.sm, alignItems: 'center', paddingHorizontal: space.lg, paddingBottom: space.lg },
});
