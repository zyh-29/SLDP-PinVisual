import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { GRID } from '@/config/hardware';
import { cellsToString, countRaised, type Pattern } from '@/domain/pattern';
import { sequenceStore } from '@/state/useSavedSequences';
import { isCompatible, MAX_NAME_LENGTH, type SavedPattern, toPattern, validateName } from '@/storage/patternStore';
import { MAX_STEPS, type SavedSequence, type SequenceStep, stepPattern, validateSteps } from '@/storage/sequenceStore';
import { Button, Label, Separator } from './components';
import { Icon, type IconName } from './Icon';
import { PinGrid } from './PinGrid';
import { Sheet } from './Sheet';
import { MIN_TOUCH, radius, space, type, useTheme } from './theme';
import { announce } from '@/voice/announce';

const SMALL_CELL = 8;

/** Make a new sequence, or change one: its name, and saved patterns (or the preview) as steps, in order. */
export function SequenceEditorSheet({
  editing,
  patterns,
  preview,
  onClose,
  onSaved,
}: {
  /** The sequence being changed; left out for a new one. */
  editing?: SavedSequence;
  patterns: SavedPattern[];
  /** The Display tab's preview, which can be added as a step too. */
  preview: Pattern;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const t = useTheme();
  const [name, setName] = useState(editing?.name ?? '');
  const [steps, setSteps] = useState<SequenceStep[]>(editing?.steps ?? []);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const usable = patterns.filter((p) => isCompatible(p, GRID.rows, GRID.cols));
  const full = steps.length >= MAX_STEPS;

  const add = (step: SequenceStep) => {
    setSteps((s) => [...s, step]);
    setError(null);
    announce(`Added ${step.name} as step ${steps.length + 1}`);
  };
  const move = (i: number, by: number) =>
    setSteps((s) => {
      const j = i + by;
      if (j < 0 || j >= s.length) return s;
      const next = s.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const removeAt = (i: number) => setSteps((s) => s.filter((_, k) => k !== i));

  const save = async () => {
    const problem = validateName(name) ?? validateSteps(steps);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    try {
      const saved = await sequenceStore.save(name, steps, editing?.id);
      onSaved(saved.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet title={editing ? 'Edit Sequence' : 'New Sequence'} action="Save" busy={saving} onCancel={onClose} onAction={save}>
      <View style={[styles.field, { backgroundColor: t.card }]}>
        <TextInput
          value={name}
          onChangeText={(v) => {
            setName(v);
            setError(null);
          }}
          placeholder="Sequence name"
          placeholderTextColor={t.textSecondary}
          autoFocus={!editing}
          maxLength={MAX_NAME_LENGTH + 10}
          accessibilityLabel="Sequence name"
          accessibilityHint={`Up to ${MAX_NAME_LENGTH} characters`}
          style={[type.body, styles.input, { color: t.text }]}
        />
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={[type.footnote, { color: t.destructive, marginLeft: space.lg }]}>
          {error}
        </Text>
      ) : (
        <Label variant="footnote" secondary style={{ marginLeft: space.lg }}>
          The patterns play in this order. Each step keeps its own copy, so changing a saved pattern later doesn’t
          change the sequence.
        </Label>
      )}

      <Label variant="footnote" secondary accessibilityRole="header" style={styles.groupTitle}>
        {`STEPS · ${steps.length}`}
      </Label>
      <View style={[styles.card, { backgroundColor: t.card }]}>
        {steps.length === 0 ? (
          <Label variant="subhead" secondary style={{ padding: space.lg }}>
            No steps yet. Add patterns from the list below.
          </Label>
        ) : (
          steps.map((s, i) => {
            const p = stepPattern(s);
            return (
              <View key={`${i}-${s.name}`}>
                {i > 0 ? <Separator inset={space.lg} /> : null}
                <View style={styles.row}>
                  <Label variant="headline" secondary style={styles.number}>
                    {i + 1}
                  </Label>
                  {p ? <PinGrid pattern={p} cellSize={SMALL_CELL} /> : null}
                  <Label variant="body" numberOfLines={2} style={{ flex: 1 }}>
                    {s.name}
                  </Label>
                  <IconButton icon="up" label={`Move ${s.name} up`} disabled={i === 0} onPress={() => move(i, -1)} />
                  <IconButton icon="down" label={`Move ${s.name} down`} disabled={i === steps.length - 1} onPress={() => move(i, 1)} />
                  <IconButton icon="close" label={`Remove step ${i + 1}, ${s.name}`} destructive onPress={() => removeAt(i)} />
                </View>
              </View>
            );
          })
        )}
      </View>

      <Label variant="footnote" secondary accessibilityRole="header" style={styles.groupTitle}>
        ADD A PATTERN
      </Label>
      <Button
        title="Add Current Preview"
        icon="plus"
        variant="secondary"
        compact
        disabled={full}
        accessibilityHint="Adds the pins on the Display tab as the next step."
        onPress={() => add({ name: `Preview (${countRaised(preview)} raised)`, rows: preview.rows, cols: preview.cols, cells: cellsToString(preview) })}
      />
      <View style={[styles.card, { backgroundColor: t.card }]}>
        {usable.length === 0 ? (
          <Label variant="subhead" secondary style={{ padding: space.lg }}>
            No saved patterns for this {GRID.rows} × {GRID.cols} grid yet. Save some from the Image or Display tab.
          </Label>
        ) : (
          usable.map((saved, i) => (
            <View key={saved.id}>
              {i > 0 ? <Separator inset={space.lg} /> : null}
              <View style={styles.row}>
                <SavedPins saved={saved} />
                <Label variant="body" numberOfLines={2} style={{ flex: 1 }}>
                  {saved.name}
                </Label>
                <Button
                  title="Add"
                  icon="plus"
                  variant="secondary"
                  compact
                  disabled={full}
                  accessibilityLabel={`Add ${saved.name}`}
                  onPress={() => add({ name: saved.name, rows: saved.rows, cols: saved.cols, cells: saved.cells })}
                />
              </View>
            </View>
          ))
        )}
      </View>
      {full ? (
        <Label variant="footnote" secondary style={{ marginLeft: space.lg }}>
          A sequence holds up to {MAX_STEPS} steps.
        </Label>
      ) : null}
    </Sheet>
  );
}

function SavedPins({ saved }: { saved: SavedPattern }) {
  const p = toPattern(saved);
  return p ? <PinGrid pattern={p} cellSize={SMALL_CELL} /> : null;
}

/** A square icon button for the step list (its label is read out instead of an icon). */
function IconButton({
  icon,
  label,
  onPress,
  disabled,
  destructive,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  const t = useTheme();
  const color = destructive ? t.destructive : t.tint;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, { backgroundColor: pressed ? t.cardPressed : t.fill, opacity: disabled ? 0.35 : 1 }]}>
      <Icon name={icon} color={color} size={16} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  field: { borderRadius: radius.md },
  input: { minHeight: 50, paddingHorizontal: space.lg },
  groupTitle: { marginLeft: space.lg, marginTop: space.sm, fontWeight: '500' },
  card: { borderRadius: radius.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm, minHeight: MIN_TOUCH + 12 },
  number: { width: 24, textAlign: 'center', fontVariant: ['tabular-nums'] },
  iconButton: { width: MIN_TOUCH - 4, height: MIN_TOUCH - 4, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
});
