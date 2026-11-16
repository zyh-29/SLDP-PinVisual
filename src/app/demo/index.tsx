import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { GRID } from '@/config/hardware';
import { boardShowsDemo, emptyDemo } from '@/domain/demo';
import { countRaised, type Pattern, togglePin } from '@/domain/pattern';
import { useBoardActions } from '@/state/useBoardActions';
import { CommandStatus } from '@/ui/CommandStatus';
import { Button, Columns, Label, Screen, Section } from '@/ui/components';
import { Icon, type IconName } from '@/ui/Icon';
import { PinGrid } from '@/ui/PinGrid';
import { MIN_TOUCH, radius, space, useTheme } from '@/ui/theme';
import { announce } from '@/voice/announce';

/**
 * Demo: the whole board (3 × 3) on its own. Tapping a pin flips it; with a board connected the grid is sent straight
 * away. The Display preview is left alone.
 */
export default function DemoScreen() {
  const t = useTheme();
  const { sendPattern, connected, busy, state } = useBoardActions();
  const [demo, setDemo] = useState<Pattern>(emptyDemo);
  /** What was last sent from here, for Retry. */
  const [lastSent, setLastSent] = useState<Pattern | null>(null);

  const sending = busy && state.command.status === 'sending' && state.command.kind === 'pattern';
  const raised = countRaised(demo);

  const send = (p: Pattern) => {
    setLastSent(p);
    void sendPattern(p);
  };
  const apply = (next: Pattern) => {
    setDemo(next);
    if (connected && !busy) send(next);
  };

  const status: { text: string; icon: IconName | null; color: string } = sending
    ? { text: 'Sending…', icon: null, color: t.textSecondary }
    : !connected
      ? { text: 'Not sent · no board connected', icon: 'disconnected', color: t.textSecondary }
      : !state.lastAcknowledgedPattern
        ? { text: 'Not sent yet', icon: 'info', color: t.textSecondary }
        : boardShowsDemo(state.lastAcknowledgedPattern, demo)
          ? { text: 'Board confirmed', icon: 'success', color: t.success }
          : { text: 'Board differs · tap Send', icon: 'error', color: t.warning };

  return (
    <Screen title="Demo">
      <Columns
        left={
          <Section padded>
            <View>
              <Label variant="headline">
                {GRID.rows} × {GRID.cols} Grid
              </Label>
              <Label variant="footnote" secondary>
                {raised} of {GRID.rows * GRID.cols} raised
              </Label>
            </View>
            <PinGrid pattern={demo} onToggle={(r, c) => apply(togglePin(demo, r, c))} disabled={sending} />
            <View style={styles.buttonRow}>
              <Button
                title="Clear"
                icon="clear"
                variant="secondary"
                compact
                style={{ flex: 1 }}
                disabled={sending || raised === 0}
                accessibilityHint={connected ? 'Lowers every demo pin on the board.' : 'Lowers every demo pin.'}
                onPress={() => {
                  apply(emptyDemo());
                  announce('Demo cleared');
                }}
              />
              <Button
                title="Send"
                icon="send"
                compact
                style={{ flex: 1 }}
                disabled={!connected || busy}
                loading={sending}
                accessibilityHint={connected ? 'Sends the grid to the board again.' : 'Unavailable: no board connected.'}
                onPress={() => send(demo)}
              />
            </View>
            <View style={styles.status} accessible accessibilityLiveRegion="polite" accessibilityLabel={status.text}>
              {status.icon ? <Icon name={status.icon} color={status.color} size={14} /> : <ActivityIndicator size="small" color={status.color} />}
              <Label variant="footnote" style={{ color: status.color }}>
                {status.text}
              </Label>
            </View>
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
              onRetrySend={() => lastSent && send(lastSent)}
              onRetryReset={() => send(emptyDemo())}
            />
            <Label variant="footnote" secondary style={{ marginHorizontal: space.lg }}>
              Tap a pin to raise or lower it. With a board connected it’s sent straight away.
            </Label>
          </View>
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  buttonRow: { flexDirection: 'row', gap: space.md },
  status: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 20 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: space.sm + 2, minHeight: MIN_TOUCH + 4, paddingHorizontal: space.lg, borderRadius: radius.md },
});
