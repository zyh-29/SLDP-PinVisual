import { useState } from 'react';
import { AccessibilityInfo, StyleSheet, TextInput, View } from 'react-native';

import { MAX_UNDO, parseUndoSteps } from '@/state/previewHistory';
import { Button, Label } from './components';
import { radius, space, type, useTheme } from './theme';

const changes = (n: number) => `${n} change${n === 1 ? '' : 's'}`;

/**
 * Undo and Redo for the preview: a number of steps (typed, 1 when left empty; the same field for both), or all
 * the way. Redo brings back what was undone until the next change. Never moves the physical pins.
 */
export function UndoControls({
  undoCount,
  redoCount,
  onUndo,
  onUndoAll,
  onRedo,
  onRedoAll,
}: {
  undoCount: number;
  redoCount: number;
  onUndo: (steps: number) => void;
  onUndoAll: () => void;
  onRedo: (steps: number) => void;
  onRedoAll: () => void;
}) {
  const t = useTheme();
  const [text, setText] = useState('');
  const steps = parseUndoSteps(text);
  /** What each button will actually do: the steps asked for, or all there are when fewer. */
  const undoing = steps === null ? 0 : Math.min(steps, undoCount);
  const redoing = steps === null ? 0 : Math.min(steps, redoCount);

  const act = (n: number, run: (n: number) => void, verb: string) => {
    if (!n) return;
    run(n);
    AccessibilityInfo.announceForAccessibility(`${verb} ${changes(n)}`);
  };
  const undo = () => act(undoing, onUndo, 'Undid');
  const redo = () => act(redoing, onRedo, 'Redid');

  const note = !undoCount && !redoCount
    ? 'Nothing to undo.'
    : [
        undoCount ? `${changes(undoCount)} to undo${undoCount >= MAX_UNDO ? ` (the last ${MAX_UNDO} are kept)` : ''}` : null,
        redoCount ? `${undoCount ? redoCount : changes(redoCount)} to redo` : null,
      ]
        .filter(Boolean)
        .join(' · ') + '.';

  return (
    <View style={{ gap: space.sm }}>
      <View style={styles.row}>
        <Button
          title={undoing > 1 ? `Undo ${undoing}` : 'Undo'}
          icon="undo"
          variant="secondary"
          compact
          style={{ flex: 1 }}
          disabled={!undoing}
          accessibilityLabel={undoing > 1 ? `Undo ${undoing} steps` : 'Undo'}
          accessibilityHint="Goes back that many changes in the preview. Does not move the physical pins."
          onPress={undo}
        />
        <TextInput
          value={text}
          onChangeText={setText}
          onSubmitEditing={undo}
          placeholder="1"
          placeholderTextColor={t.textSecondary}
          keyboardType="number-pad"
          returnKeyType="done"
          maxLength={3}
          accessibilityLabel="Steps to undo or redo"
          accessibilityHint="How many changes Undo and Redo go. Leave it empty for 1."
          style={[type.body, styles.steps, { color: t.text, backgroundColor: t.fill, borderColor: steps === null ? t.destructive : 'transparent' }]}
        />
        <Button
          title={redoing > 1 ? `Redo ${redoing}` : 'Redo'}
          icon="redo"
          variant="secondary"
          compact
          style={{ flex: 1 }}
          disabled={!redoing}
          accessibilityLabel={redoing > 1 ? `Redo ${redoing} steps` : 'Redo'}
          accessibilityHint="Brings back that many undone changes. Does not move the physical pins."
          onPress={redo}
        />
      </View>
      <View style={styles.row}>
        <Button
          title="Undo All"
          variant="secondary"
          compact
          style={{ flex: 1 }}
          disabled={!undoCount}
          accessibilityHint="Goes back to the oldest preview kept. Redo All brings it back. Does not move the physical pins."
          onPress={() => act(undoCount, onUndoAll, 'Undid all')}
        />
        <Button
          title="Redo All"
          variant="secondary"
          compact
          style={{ flex: 1 }}
          disabled={!redoCount}
          accessibilityHint="Brings back everything undone. Does not move the physical pins."
          onPress={() => act(redoCount, onRedoAll, 'Redid all')}
        />
      </View>
      <Label
        variant="footnote"
        secondary={steps !== null}
        style={steps === null ? { color: t.destructive } : undefined}
        accessibilityLiveRegion="polite">
        {steps === null ? 'Type a whole number of steps, like 3.' : note}
      </Label>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  steps: { width: 64, minHeight: 44, borderRadius: radius.sm, borderWidth: 1.5, textAlign: 'center', paddingHorizontal: space.sm },
});
