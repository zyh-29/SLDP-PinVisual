import { router } from 'expo-router';
import { useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, View } from 'react-native';

import { GRID } from '@/config/hardware';
import { countRaised, patternsEqual } from '@/domain/pattern';
import { usePattern } from '@/state/PatternProvider';
import { useBoardActions } from '@/state/useBoardActions';
import { CommandStatus } from '@/ui/CommandStatus';
import { Button, Columns, Label, Screen, Section, StatusBanner } from '@/ui/components';
import { Icon } from '@/ui/Icon';
import { PinGrid } from '@/ui/PinGrid';
import { SavePatternSheet } from '@/ui/SavePatternSheet';
import { HistoryTimeline } from '@/ui/HistoryTimeline';
import { MIN_TOUCH, radius, space, useTheme } from '@/ui/theme';
import { useUndoShortcuts } from '@/ui/useUndoShortcuts';

export default function DisplayScreen() {
  const { pattern, source, toggle, clear, undo, redo, steps, position, jumpTo } = usePattern();
  const { send, reset, connected, busy, state } = useBoardActions();
  const [saveOpen, setSaveOpen] = useState(false);
  const t = useTheme();
  useUndoShortcuts(undo, redo);

  const raised = countRaised(pattern);
  const total = GRID.rows * GRID.cols;
  const last = state.lastAcknowledgedPattern;
  const changedSinceSend = connected && last !== null && !patternsEqual(last, pattern);

  return (
    <Screen title="Display">
      <Columns
        left={
      <Section padded>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Label variant="headline">Preview</Label>
            <Label variant="footnote" secondary>
              {raised} of {total} raised · {GRID.rows} × {GRID.cols}
              {source ? ` · ${source}` : ''}
            </Label>
          </View>
        </View>
        <PinGrid pattern={pattern} onToggle={toggle} />
        <View style={styles.buttonRow}>
          <Button
            title="Clear Grid"
            icon="clear"
            variant="secondary"
            compact
            style={{ flex: 1 }}
            accessibilityHint="Lowers every pin in the preview only. Does not move the physical pins."
            onPress={() => {
              clear();
              AccessibilityInfo.announceForAccessibility('Preview cleared');
            }}
          />
          <Button title="Save" icon="save" variant="secondary" compact style={{ flex: 1 }} onPress={() => setSaveOpen(true)} />
        </View>
        <HistoryTimeline steps={steps} position={position} onJump={jumpTo} />
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
        ) : changedSinceSend && state.command.status !== 'sending' ? (
          <StatusBanner tone="neutral" title="Preview changed" message="The preview differs from the last pattern the board received." />
        ) : null}

        <CommandStatus command={state.command} connected={connected} onRetrySend={send} onRetryReset={reset} />

        <Button
          title="Send Pattern"
          icon="send"
          onPress={send}
          disabled={!connected || busy}
          loading={busy && state.command.status === 'sending' && state.command.kind === 'pattern'}
          accessibilityHint={connected ? 'Sends the preview to the board and waits for acknowledgement.' : 'Unavailable: no board connected.'}
        />
        <Button
          title="Reset Physical Pins"
          icon="reset"
          variant="destructive"
          onPress={reset}
          disabled={!connected || busy}
          loading={busy && state.command.status === 'sending' && state.command.kind === 'reset'}
          accessibilityHint={
            connected
              ? 'Tells the board to lower every pin. The preview clears after the board acknowledges.'
              : 'Unavailable: no board connected.'
          }
        />
        <Label variant="footnote" secondary style={{ marginHorizontal: space.lg }}>
          Editing the preview never moves the pins. Changes reach the board only when you send.
        </Label>
      </View>
        }
      />

      <SavePatternSheet
        visible={saveOpen}
        pattern={pattern}
        initialName={source && source !== 'From image' ? source : ''}
        onClose={() => setSaveOpen(false)}
        onSaved={(name) => {
          setSaveOpen(false);
          AccessibilityInfo.announceForAccessibility(`Saved ${name}`);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  buttonRow: { flexDirection: 'row', gap: space.md },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm + 2,
    minHeight: MIN_TOUCH + 4,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
  },
});
