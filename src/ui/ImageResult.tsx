import { StyleSheet, View } from 'react-native';

import { GRID } from '@/config/hardware';
import { countRaised, type Pattern } from '@/domain/pattern';
import { Button, Label, Section } from './components';
import { PinGrid } from './PinGrid';
import { radius, space } from './theme';

/**
 * The Image tab's Result card: the pins, the pin lock (and Reset after an edit), the live pin count, and
 * Use This Pattern / Save.
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
            variant={unlocked ? 'secondary' : 'destructive'}
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
    </Section>
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
