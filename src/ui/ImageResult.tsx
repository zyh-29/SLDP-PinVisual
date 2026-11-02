import { StyleSheet, View } from 'react-native';

import { GRID } from '@/config/hardware';
import type { CommandState } from '@/device/DeviceController';
import { countRaised, type Pattern } from '@/domain/pattern';
import { CommandStatus } from './CommandStatus';
import { Button, Label, Section, Separator } from './components';
import { SwitchRow } from './SettingRows';
import { PinGrid } from './PinGrid';
import { radius, space } from './theme';

/**
 * The Image tab's Result card: the pins, the pin lock (and Reset after an edit), the live pin count, and
 * Use This Pattern / Save, and Send to Board / Clear Board.
 */
export function ImageResult({
  pattern,
  unlocked,
  edited,
  onToggleLock,
  onTogglePin,
  onReset,
  onUse,
  onSave,
  board,
  liveSend,
}: {
  /** What the user gets: their edited pins, or the automatic ones. */
  pattern: Pattern;
  unlocked: boolean;
  /** The user changed pins (Reset is offered). */
  edited: boolean;
  onToggleLock: () => void;
  onTogglePin: (row: number, col: number) => void;
  onReset: () => void;
  onUse: () => void;
  onSave: () => void;
  /** Sending this pattern to the board, or lowering every pin, straight from the Image tab. */
  board: { connected: boolean; command: CommandState; onSend: () => void; onClear: () => void };
  /** Live share or camera: the pins can follow it on the board. */
  liveSend?: { on: boolean; onChange: (on: boolean) => void; connected: boolean; error: string | null };
}) {
  const raised = countRaised(pattern);
  const total = GRID.rows * GRID.cols;
  return (
    <Section title="Result">
      <PinGrid pattern={pattern} onToggle={unlocked ? onTogglePin : undefined} />
      {/* Under the grid, a toolbar laid out like the button row below it: the lock (and Reset after an edit)
          span the same width as Use This Pattern, and the live pin count sits in the Save column. */}
      <View style={styles.resultBar}>
        <View style={styles.resultTools}>
          <Button
            title={unlocked ? 'Unlocked' : 'Locked'}
            icon={unlocked ? 'unlock' : 'lock'}
            variant="secondary"
            compact
            style={styles.pill}
            onPress={onToggleLock}
            accessibilityLabel={unlocked ? 'Pins unlocked' : 'Pins locked'}
            accessibilityHint={unlocked ? 'Locks the pins so taps do nothing' : 'Unlocks the pins so you can raise or lower each one'}
          />
          {edited ? (
            <Button
              title="Reset"
              icon="undo"
              variant="secondary"
              compact
              style={styles.pill}
              onPress={onReset}
              accessibilityLabel="Reset pins"
              accessibilityHint="Discards your pin changes and follows the image again"
            />
          ) : null}
        </View>
        <Label
          variant="headline"
          secondary
          numberOfLines={1}
          accessibilityLabel={`${raised} of ${total} pins raised`}
          style={[styles.sideColumn, styles.pinCount]}>
          {raised} of {total}
        </Label>
      </View>
      <View style={styles.buttonRow}>
        <Button
          title="Use This Pattern"
          icon="edit"
          style={{ flex: 1 }}
          onPress={onUse}
          accessibilityHint="Replaces the preview on the Display tab, where you can edit and send it."
        />
        <Button
          title="Save"
          icon="save"
          variant="secondary"
          style={styles.sideColumn}
          onPress={onSave}
          accessibilityLabel="Save Pattern"
          accessibilityHint="Saves this pattern so you can load it later from the Saved tab."
        />
      </View>
      <Separator />
      <BoardButtons board={board} liveSending={!!liveSend?.on} />
      {liveSend ? (
        <>
          <Separator />
          {liveSend.connected ? (
            <SwitchRow
              title="Send Live to Board"
              hint="The board's pins follow the live picture as it changes, about twice a second"
              value={liveSend.on}
              onChange={liveSend.onChange}
            />
          ) : (
            <Label variant="footnote" secondary>
              Connect a board on the Device tab to have its pins follow the live picture.
            </Label>
          )}
          {liveSend.on && liveSend.error ? (
            <Label variant="footnote" secondary accessibilityLiveRegion="polite">
              Last update didn’t reach the board: {liveSend.error}
            </Label>
          ) : null}
        </>
      ) : null}
    </Section>
  );
}

/** Send to Board and Clear Board (labelled Send and Clear, to fit a phone), with the result of the last command under them. */
function BoardButtons({
  board: { connected, command, onSend, onClear },
  liveSending,
}: {
  board: { connected: boolean; command: CommandState; onSend: () => void; onClear: () => void };
  /** Send Live to Board is on: it keeps the board up to date, and its updates would fill the status below. */
  liveSending: boolean;
}) {
  const busy = command.status === 'sending';
  const off = !connected || busy || liveSending;
  const why = !connected ? 'Unavailable: no board connected.' : liveSending ? 'Unavailable while Send Live to Board is on.' : undefined;
  return (
    <>
      <View style={styles.buttonRow}>
        <Button
          title="Send"
          icon="send"
          accessibilityLabel="Send to Board"
          style={{ flex: 1 }}
          onPress={onSend}
          disabled={off}
          loading={busy && !liveSending && command.kind === 'pattern'}
          accessibilityHint={why ?? 'Sends these pins to the board and waits for acknowledgement.'}
        />
        <Button
          title="Clear"
          icon="reset"
          accessibilityLabel="Clear Board"
          variant="destructive"
          style={{ flex: 1 }}
          onPress={onClear}
          disabled={off}
          loading={busy && !liveSending && command.kind === 'reset'}
          accessibilityHint={why ?? 'Tells the board to lower every pin.'}
        />
      </View>
      {!connected ? (
        <Label variant="footnote" secondary>
          Send and Clear move the board’s pins. Connect a board on the Device tab first.
        </Label>
      ) : !liveSending ? (
        <CommandStatus command={command} connected={connected} onRetrySend={onSend} onRetryReset={onClear} />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  buttonRow: { flexDirection: 'row', gap: space.sm },
  resultBar: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  /** Same width as Use This Pattern; the lock and Reset share it equally. */
  resultTools: { flex: 1, flexDirection: 'row', gap: space.sm },
  /** Same width as Save, so the two rows line up; the pin count is centred in it. */
  sideColumn: { width: 100, flexShrink: 0 },
  pinCount: { textAlign: 'center', fontVariant: ['tabular-nums'] },
  /** Compact capsule buttons: each starts at its label's width, then they share the rest of the row. */
  pill: { flexGrow: 1, flexShrink: 1, flexBasis: 'auto', borderRadius: radius.pill, paddingHorizontal: space.sm },
});
