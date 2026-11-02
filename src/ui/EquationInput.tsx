import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Label, tapFeedback } from './components';
import { MIN_TOUCH, radius, space, type, useTheme } from './theme';

/** Type an equation (y = x^2 - 3) and draw it on the pins: one field, with Draw at its end. */
export function EquationInput({
  initial = '',
  onDraw,
  error,
  row,
}: {
  /** As a row of an inset grouped list (the row is the field), not a filled box. */
  row?: boolean;
  initial?: string;
  onDraw: (text: string) => void;
  /** Why the last equation couldn't be drawn. */
  error: string | null;
}) {
  const t = useTheme();
  const [text, setText] = useState(initial);
  const ready = !!text.trim();
  const draw = () => ready && onDraw(text);
  return (
    <View style={{ gap: space.xs }}>
      <View style={[styles.field, row ? styles.row : { backgroundColor: t.fill }]}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="y = x^2 - 3"
          placeholderTextColor={t.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          enterKeyHint="go"
          onSubmitEditing={draw}
          accessibilityLabel="Equation"
          accessibilityHint="For example y = x^2 - 3, sin(x), or 1/x. Then press Draw."
          style={[type.body, styles.input, { color: t.text }]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Draw"
          accessibilityHint="Draws the equation on the pins"
          accessibilityState={{ disabled: !ready }}
          disabled={!ready}
          onPress={() => {
            tapFeedback();
            draw();
          }}
          style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
            styles.draw,
            { opacity: pressed ? 0.6 : 1 },
            ready && hovered && { backgroundColor: t.tintSoft },
          ]}>
          <Text style={[type.headline, { color: ready ? t.tint : t.textSecondary }]}>Draw</Text>
        </Pressable>
      </View>
      {error ? (
        <Label variant="footnote" style={[{ color: t.destructive }, row && { marginHorizontal: space.lg, marginBottom: space.md }]} accessibilityLiveRegion="polite">
          {error}
        </Label>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { flexDirection: 'row', alignItems: 'center', minHeight: MIN_TOUCH, borderRadius: radius.md - 2, paddingLeft: space.md, paddingRight: 4 },
  row: { minHeight: MIN_TOUCH + 8, paddingLeft: space.lg, paddingRight: space.sm },
  input: { flex: 1, minHeight: MIN_TOUCH - 4, outlineStyle: 'none' } as object,
  draw: { minHeight: 36, paddingHorizontal: space.md, borderRadius: radius.sm, justifyContent: 'center' },
});
