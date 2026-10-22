import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, TextInput, View } from 'react-native';

import { Label } from './components';
import { SheetBar } from './SheetBar';
import { monoFont, radius, space, type, useTheme } from './theme';

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
        <SheetBar title="Import Patterns" action="Import" busy={busy} onCancel={onClose} onAction={submit} />
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
  body: { padding: space.lg, gap: space.md, flex: 1 },
  field: { borderRadius: radius.md, flex: 1, maxHeight: 360 },
  input: { flex: 1, padding: space.lg, textAlignVertical: 'top', fontFamily: monoFont },
});
