import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { Button, Label } from './components';
import { radius, space, type, useTheme } from './theme';

/** Type an equation (y = x^2 - 3) and draw it on the pins. */
export function EquationInput({
  initial = '',
  onDraw,
  error,
}: {
  initial?: string;
  onDraw: (text: string) => void;
  /** Why the last equation couldn't be drawn. */
  error: string | null;
}) {
  const t = useTheme();
  const [text, setText] = useState(initial);
  const draw = () => text.trim() && onDraw(text);
  return (
    <View style={{ gap: space.xs }}>
      <View style={styles.row}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="y = x^2 - 3"
          placeholderTextColor={t.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          onSubmitEditing={draw}
          accessibilityLabel="Equation"
          accessibilityHint="For example y = x^2 - 3, sin(x), or 1/x. Then press Draw."
          style={[type.body, styles.input, { color: t.text, backgroundColor: t.fill }]}
        />
        <Button title="Draw" icon="edit" onPress={draw} disabled={!text.trim()} style={styles.draw} accessibilityHint="Draws the equation on the pins" />
      </View>
      {error ? (
        <Label variant="footnote" style={{ color: t.destructive }} accessibilityLiveRegion="polite">
          {error}
        </Label>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  input: { flex: 1, minHeight: 50, paddingHorizontal: space.md, borderRadius: radius.sm },
  draw: { flexShrink: 0 },
});
