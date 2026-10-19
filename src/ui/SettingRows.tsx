import Slider from '@react-native-community/slider';
import { StyleSheet, Switch, View } from 'react-native';

import { Button, Label } from './components';
import { space, useTheme } from './theme';

/** A setting with an on/off switch. */
export function SwitchRow({ title, hint, value, onChange }: { title: string; hint: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.switchRow}>
      <Label variant="body" style={{ flex: 1 }}>
        {title}
      </Label>
      <Switch value={value} onValueChange={onChange} accessibilityLabel={title} accessibilityHint={hint} />
    </View>
  );
}

/** A setting with a slider and − / + buttons (for precise steps and for people who can't drag). */
export function SliderRow(p: {
  title: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  hint: string;
  onChange: (v: number) => void;
  /** When given, an "Auto" button returns the setting to automatic. */
  onAuto?: () => void;
}) {
  const t = useTheme();
  const set = (v: number) => p.onChange(Math.min(p.max, Math.max(p.min, Math.round(v / p.step) * p.step)));
  return (
    <View style={{ gap: space.xs }}>
      <View style={styles.header}>
        <Label variant="body">{p.title}</Label>
        <View style={styles.value}>
          {p.onAuto ? (
            <Button title="Auto" variant="plain" compact onPress={p.onAuto} accessibilityHint={`Sets ${p.title} automatically again`} />
          ) : null}
          <Label variant="body" secondary style={{ fontVariant: ['tabular-nums'] }}>
            {p.display}
          </Label>
        </View>
      </View>
      <View style={styles.sliderRow}>
        <Button
          title=""
          accessibilityLabel={`Decrease ${p.title}`}
          icon="minus"
          variant="secondary"
          compact
          style={styles.stepButton}
          onPress={() => set(p.value - p.step)}
        />
        <Slider
          style={{ flex: 1, height: 44 }}
          minimumValue={p.min}
          maximumValue={p.max}
          step={p.step}
          value={p.value}
          onValueChange={set}
          minimumTrackTintColor={t.tint}
          maximumTrackTintColor={t.fill}
          accessibilityLabel={p.title}
          accessibilityHint={p.hint}
          accessibilityValue={{
            min: p.min,
            max: p.max,
            now: p.value,
            text: p.display,
          }}
        />
        <Button
          title=""
          accessibilityLabel={`Increase ${p.title}`}
          icon="plus"
          variant="secondary"
          compact
          style={styles.stepButton}
          onPress={() => set(p.value + p.step)}
        />
      </View>
    </View>
  );
}

export const settingStyles = StyleSheet.create({
  /** A setting's title on the left, its value on the right. */
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 32 },
});

const styles = StyleSheet.create({
  header: settingStyles.header,
  value: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  sliderRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  stepButton: { width: 44, paddingHorizontal: 0 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 44,
  },
});
