import { Pressable, StyleSheet, Text, View } from 'react-native';

import { space, type, useTheme } from './theme';

/** The top bar of a page sheet: Cancel, the title, and the action (dimmed while it runs). */
export function SheetBar({
  title,
  action,
  busy,
  onCancel,
  onAction,
}: {
  title: string;
  action: string;
  busy: boolean;
  onCancel: () => void;
  onAction: () => void;
}) {
  const t = useTheme();
  return (
    <View style={[styles.bar, { borderBottomColor: t.separator }]}>
      <Pressable accessibilityRole="button" onPress={onCancel} hitSlop={12} style={styles.button}>
        <Text style={[type.body, { color: t.tint }]}>Cancel</Text>
      </Pressable>
      <Text accessibilityRole="header" style={[type.headline, { color: t.text }]}>
        {title}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: busy }}
        disabled={busy}
        onPress={onAction}
        hitSlop={12}
        style={styles.button}>
        <Text style={[type.headline, { color: t.tint, opacity: busy ? 0.4 : 1, textAlign: 'right' }]}>{action}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    height: 56,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  button: { minWidth: 64, minHeight: 44, justifyContent: 'center' },
});
