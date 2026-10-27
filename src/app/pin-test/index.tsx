import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { pinInfo, pinRaisedIn, singlePin, TEST_PIN } from '@/domain/pinTest';
import { useBoardActions } from '@/state/useBoardActions';
import { CommandStatus } from '@/ui/CommandStatus';
import { Button, Columns, Label, Screen, Section, tapFeedback } from '@/ui/components';
import { Icon } from '@/ui/Icon';
import { PinDot } from '@/ui/PinGrid';
import { MIN_TOUCH, radius, space, useTheme } from '@/ui/theme';

/** How big the one pin is drawn: its cell, like one of the Display grid's cells but larger. */
const PIN_CELL = 160;

/**
 * Pin Test: one pin, on or off, for testing a servo. Tapping it always flips it; with a board connected it also
 * sends the same pattern command as the Display tab, with only this pin raised (or every pin lowered). The Display
 * preview is left alone.
 */
export default function PinTestScreen() {
  const t = useTheme();
  const { sendPattern, connected, busy, state } = useBoardActions();
  /** What was last sent from here, for Retry. */
  const [lastSent, setLastSent] = useState<boolean | null>(null);

  /** The pin as tapped. Clickable with or without a board: without one, nothing is sent. */
  const [up, setUp] = useState(false);

  const { row, col, gpio, servo } = pinInfo(TEST_PIN);
  const where = row === 1 && col === 1 ? 'Top-left pin' : `Row ${row}, column ${col}`;
  /** What the board last confirmed (shown when it differs from the pin, e.g. after a failed send). */
  const boardUp = pinRaisedIn(state.lastAcknowledgedPattern, TEST_PIN);
  const sending = busy && state.command.status === 'sending' && state.command.kind === 'pattern';

  const send = (raised: boolean) => {
    setLastSent(raised);
    void sendPattern(singlePin(TEST_PIN, raised));
  };
  const toggle = () => {
    const next = !up;
    setUp(next);
    if (connected && !busy) send(next);
  };
  const status = sending
    ? 'Sending…'
    : !connected
      ? 'not sent: no board connected'
      : !state.lastAcknowledgedPattern
        ? 'not sent yet'
        : boardUp === up
          ? 'board confirmed'
          : `board has it ${boardUp ? 'up' : 'down'}`;

  return (
    <Screen title="Pin Test">
      <Columns
        left={
          <Section padded>
            <Label variant="headline">Pin</Label>
            <Label variant="footnote" secondary>
              {up ? 'Up' : 'Down'} · {status}
            </Label>
            <Label variant="footnote" secondary>
              {where} ·{' '}
              {gpio !== null
                ? `servo on ESP32 pin D${gpio} (GPIO ${gpio})`
                : `servo board ${servo.board + 1} (I²C 0x${servo.i2cAddress.toString(16).toUpperCase()}), channel ${servo.channel}`}
            </Label>
            <Pressable
              accessibilityRole="switch"
              accessibilityLabel="Test pin"
              accessibilityState={{ checked: up, disabled: sending, busy: sending }}
              accessibilityHint={`Double tap to ${up ? 'lower' : 'raise'} the pin.${connected ? ' Sends it to the board.' : ' No board connected: nothing is sent.'}`}
              disabled={sending}
              onPress={() => {
                tapFeedback();
                toggle();
              }}
              style={({ pressed }) => [styles.well, { backgroundColor: t.gridWell, opacity: pressed ? 0.6 : 1 }]}>
              <View style={styles.cell}>
                <PinDot raised={up} size={PIN_CELL} colors={t} />
              </View>
            </Pressable>
            <Button
              title={up ? 'Lower Pin' : 'Raise Pin'}
              icon={up ? 'down' : 'up'}
              variant={up ? 'secondary' : 'primary'}
              compact
              disabled={sending}
              loading={sending}
              accessibilityHint={up ? 'Lowers the pin on the board.' : 'Raises the pin on the board. Every other pin goes down.'}
              onPress={toggle}
            />
          </Section>
        }
        right={
          <View style={{ gap: space.md }}>
            {!connected ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="No board connected. Open the Device tab to connect a board."
                onPress={() => router.navigate('/device')}
                style={({ pressed }) => [styles.notice, { backgroundColor: pressed ? t.cardPressed : t.card }]}>
                <Icon name="disconnected" color={t.textSecondary} size={18} />
                <Label variant="subhead" style={{ flex: 1 }}>
                  No board connected.{' '}
                  <Label variant="subhead" style={{ color: t.tint, fontWeight: '600' }}>
                    Connect…
                  </Label>
                </Label>
                <Icon name="chevron" color={t.textSecondary} size={14} />
              </Pressable>
            ) : null}
            <CommandStatus
              command={state.command}
              connected={connected}
              onRetrySend={() => lastSent !== null && send(lastSent)}
              onRetryReset={() => send(false)}
            />
            <Label variant="footnote" secondary style={{ marginHorizontal: space.lg }}>
              Tap the pin to raise or lower it. With a board connected it’s sent straight away; raising it lowers every
              other pin. The Display preview doesn’t change.
            </Label>
          </View>
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  well: { borderRadius: radius.md, paddingVertical: space.lg, alignItems: 'center', marginVertical: space.md },
  cell: { width: PIN_CELL, height: PIN_CELL, alignItems: 'center', justifyContent: 'center' },
  notice: { flexDirection: 'row', alignItems: 'center', gap: space.sm + 2, minHeight: MIN_TOUCH + 4, paddingHorizontal: space.lg, borderRadius: radius.md },
});
