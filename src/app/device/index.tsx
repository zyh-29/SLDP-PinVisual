import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Switch, View } from 'react-native';

import { BLE, GRID, PROTOCOL } from '@/config/hardware';
import { useDevice } from '@/state/DeviceProvider';
import { useBoardActions } from '@/state/useBoardActions';
import { AppearancePicker } from '@/ui/AppearancePicker';
import { CommandStatus } from '@/ui/CommandStatus';
import { Button, Columns, Label, Row, Screen, Section, Separator, StatusBanner } from '@/ui/components';
import { connectionSummary } from '@/ui/ConnectionPill';
import { Icon } from '@/ui/Icon';
import { useResponsive } from '@/ui/layout';
import { SpeechSettings } from '@/ui/SpeechSettings';
import { space, useTheme } from '@/ui/theme';

export default function DeviceScreen() {
  const t = useTheme();
  const { state, controller } = useDevice();
  const { send, reset, connected, busy } = useBoardActions();
  const [showAll, setShowAll] = useState(false);
  const { sidebar } = useResponsive();

  const c = state.connection;
  const summary = connectionSummary(c);

  useEffect(() => () => controller.stopScan(), [controller]);

  // Browsers without Web Bluetooth (Safari, Firefox, iOS) get told up front.
  const [bleUnavailable, setBleUnavailable] = useState<string | null>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let live = true;
    controller.driver.availability().then(
      (reason) => live && setBleUnavailable(reason),
      (e: unknown) => live && setBleUnavailable(`Bluetooth could not be checked: ${e instanceof Error ? e.message : String(e)}`),
    );
    return () => {
      live = false;
    };
  }, [controller]);
  const picker = !!controller.driver.selectsWithSystemPicker;

  return (
    <Screen title="Device">
      <Columns
        left={
          <>
      {/* Connection status */}
      <Section title="Status">
        <View style={styles.statusRow} accessible accessibilityLabel={summary.long}>
          <View style={[styles.statusIcon, { backgroundColor: summary.kind === 'real' ? t.successSoft : t.fill }]}>
            {summary.kind === 'busy' ? (
              <ActivityIndicator color={t.tint} />
            ) : (
              <Icon
                name={summary.kind === 'real' ? 'connected' : 'disconnected'}
                color={summary.kind === 'real' ? t.success : t.textSecondary}
                size={22}
              />
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Label variant="headline">{summary.short}</Label>
            <Label variant="footnote" secondary>
              {c.status === 'connected'
                ? `${c.deviceName} · MTU ${c.mtu} · ${c.maxWriteSize}-byte writes`
                : c.status === 'connecting'
                  ? c.deviceName
                  : picker
                    ? 'Choose your board below'
                    : 'Scan below to find your board'}
            </Label>
          </View>
        </View>
        {c.status === 'disconnected' && c.error ? <StatusBanner tone="error" title="Connection problem" message={c.error} /> : null}
        {c.status === 'connected' ? (
          <Button title="Disconnect" variant="secondary" compact onPress={() => controller.disconnect()} disabled={busy} />
        ) : null}
      </Section>

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
            Reset needs a connected board.
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

      <SpeechSettings />

      {/* The website's sidebar has its own; phones and narrow browsers get it here. */}
      {!sidebar ? (
        <Section title="Appearance" footer="Automatic matches your device's light or dark setting.">
          <AppearancePicker />
        </Section>
      ) : null}
          </>
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  statusIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  scanControls: { padding: space.lg, gap: space.md },
  switchRow: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  scanning: { flexDirection: 'row', gap: space.sm, alignItems: 'center', paddingHorizontal: space.lg, paddingBottom: space.lg },
});
