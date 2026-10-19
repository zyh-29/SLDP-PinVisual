import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Label } from './components';
import { radius, space, type, useTheme } from './theme';

/**
 * Import on phones: paste the text of an exported patterns file (from Notes, Files, a message to yourself).
 * `onImport` throws with a readable message when the text isn't an export; the sheet then shows it.
 */
export function ImportPasteSheet({
  visible,
  onClose,
  onImport,
}: {
  visible: boolean;
  onClose: () => void;
  onImport: (text: string) => Promise<void>;
}) {
  const t = useTheme();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!text.trim()) {
      setError('Paste the exported text first.');
      return;
    }
    setBusy(true);
    try {
      await onImport(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onShow={() => {
        setText('');
        setError(null);
      }}
      onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: t.background }}>
        <View style={[styles.bar, { borderBottomColor: t.separator }]}>
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={12} style={styles.barButton}>
            <Text style={[type.body, { color: t.tint }]}>Cancel</Text>
          </Pressable>
          <Text accessibilityRole="header" style={[type.headline, { color: t.text }]}>
            Import Patterns
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={submit}
            hitSlop={12}
            style={styles.barButton}>
            <Text style={[type.headline, { color: t.tint, opacity: busy ? 0.4 : 1, textAlign: 'right' }]}>Import</Text>
          </Pressable>
        </View>
        <View style={styles.body}>
          <Label variant="footnote" secondary style={{ marginHorizontal: space.lg }}>
            Paste the text you exported. Patterns already here are kept; nothing is replaced.
          </Label>
          <View style={[styles.field, { backgroundColor: t.card }]}>
            <TextInput
              value={text}
              onChangeText={(v) => {
                setText(v);
                setError(null);
              }}
              placeholder='{"format": "pinvisual-patterns", …}'
              placeholderTextColor={t.textSecondary}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Exported patterns text"
              style={[type.footnote, styles.input, { color: t.text }]}
            />
          </View>
          {error ? (
            <Text accessibilityRole="alert" style={[type.footnote, { color: t.destructive, marginLeft: space.lg }]}>
              {error}
            </Text>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
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
  barButton: { minWidth: 64, minHeight: 44, justifyContent: 'center' },
  body: { padding: space.lg, gap: space.md, flex: 1 },
  field: { borderRadius: radius.md, flex: 1, maxHeight: 360 },
  input: { flex: 1, padding: space.lg, textAlignVertical: 'top', fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
});
