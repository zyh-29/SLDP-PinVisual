import { useState } from 'react';
import { AccessibilityInfo, StyleSheet, TextInput, View } from 'react-native';

import { MAX_UNDO, parseUndoSteps } from '@/state/previewHistory';
import { Button, Label } from './components';
import { confirmAsync } from './dialogs';
import { radius, space, type, useTheme } from './theme';

const changes = (n: number) => `${n} change${n === 1 ? '' : 's'}`;

/**
 * Undo for the preview: back a number of steps (typed, 1 when left empty), or all the way. There is no redo, so
 * Undo All asks first when it would undo more than one change. Never moves the physical pins.
 */
export function UndoControls({ count, onUndo, onUndoAll }: { count: number; onUndo: (steps: number) => void; onUndoAll: () => void }) {
  const t = useTheme();
  const [text, setText] = useState('');
  const steps = parseUndoSteps(text);
  /** What Undo will actually do: the steps asked for, or all there are when fewer. */
  const doing = steps === null ? 0 : Math.min(steps, count);

  const undo = () => {
    if (!doing) return;
    onUndo(doing);
    AccessibilityInfo.announceForAccessibility(`Undid ${changes(doing)}`);
  };
  const undoAll = async () => {
    if (!count) return;
    if (count > 1) {
      const ok = await confirmAsync({
        title: `Undo all ${changes(count)}?`,
        message: 'The preview goes back to how it was before them. This can’t be redone.',
        confirmLabel: 'Undo All',
        destructive: true,
      });
      if (!ok) return;
    }
    onUndoAll();
    AccessibilityInfo.announceForAccessibility(`Undid all ${changes(count)}`);
  };

  const note =
    steps === null
      ? null
      : !count
        ? 'Nothing to undo.'
        : steps > count
          ? `Only ${changes(count)} to undo: Undo goes back ${count}.`
          : `${changes(count)} to undo${count >= MAX_UNDO ? ` (the last ${MAX_UNDO} are kept)` : ''}.`;

  return (
    <View style={{ gap: space.xs }}>
      <View style={styles.row}>
        <Button
          title={doing > 1 ? `Undo ${doing}` : 'Undo'}
          icon="undo"
          variant="secondary"
          compact
          style={{ flex: 1 }}
          disabled={!doing}
          accessibilityLabel={doing > 1 ? `Undo ${doing} steps` : 'Undo'}
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
          accessibilityLabel="Steps to undo"
          accessibilityHint="How many changes Undo goes back. Leave it empty for 1."
          style={[type.body, styles.steps, { color: t.text, backgroundColor: t.fill, borderColor: steps === null ? t.destructive : 'transparent' }]}
        />
        <Button
          title="Undo All"
          variant="secondary"
          compact
          style={{ flex: 1 }}
          disabled={!count}
          accessibilityHint="Goes back to the oldest preview kept. Asks first. Does not move the physical pins."
          onPress={undoAll}
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
