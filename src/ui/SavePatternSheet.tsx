import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { Pattern } from '@/domain/pattern';
import { patternStore } from '@/state/useSavedPatterns';
import { MAX_NAME_LENGTH, validateName } from '@/storage/patternStore';
import { Label } from './components';
import { confirmAsync } from './dialogs';
import { useResponsive } from './layout';
import { PinGrid } from './PinGrid';
import { radius, space, type, useTheme } from './theme';

export function SavePatternSheet({
  visible,
  pattern,
  initialName,
  onClose,
  onSaved,
}: {
  visible: boolean;
  pattern: Pattern;
  initialName?: string;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const t = useTheme();
  const { width } = useResponsive();
  // Wide browsers get a centred dialog; phones keep the iOS-style sheet.
  const dialog = Platform.OS === 'web' && width >= 600;
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const onShow = () => {
    setName(initialName ?? '');
    setError(null);
  };

  const doSave = async (overwrite: boolean) => {
    setSaving(true);
    try {
      const saved = await patternStore.save(name, pattern, { overwrite });
      onSaved(saved.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const submit = async () => {
    const v = validateName(name);
    if (v) {
      setError(v);
      return;
    }
    const existing = await patternStore.findByName(name);
    if (existing) {
      const ok = await confirmAsync({
        title: 'Replace pattern?',
        message: `A pattern named "${existing.name}" already exists.`,
        confirmLabel: 'Replace',
        destructive: true,
      });
      if (ok) doSave(true);
      return;
    }
    doSave(false);
  };

  return (
    <Modal
      visible={visible}
      animationType={dialog ? 'fade' : 'slide'}
      presentationStyle={dialog ? 'overFullScreen' : 'pageSheet'}
      transparent={dialog}
      onShow={onShow}
      onRequestClose={onClose}>
      <View style={dialog ? styles.backdrop : { flex: 1 }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[{ backgroundColor: t.background }, dialog ? styles.dialog : { flex: 1 }]}
        aria-modal
        role="dialog">
        <View style={[styles.bar, { borderBottomColor: t.separator }]}>
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={12} style={styles.barButton}>
            <Text style={[type.body, { color: t.tint }]}>Cancel</Text>
          </Pressable>
          <Text accessibilityRole="header" style={[type.headline, { color: t.text }]}>
            Save Pattern
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: saving }}
            disabled={saving}
            onPress={submit}
            hitSlop={12}
            style={styles.barButton}>
            <Text style={[type.headline, { color: t.tint, opacity: saving ? 0.4 : 1, textAlign: 'right' }]}>Save</Text>
          </Pressable>
        </View>

        <View style={styles.body}>
          <View style={[styles.field, { backgroundColor: t.card }]}>
            <TextInput
              value={name}
              onChangeText={(v) => {
                setName(v);
                setError(null);
              }}
              placeholder="Pattern name"
              placeholderTextColor={t.textSecondary}
              autoFocus
              maxLength={MAX_NAME_LENGTH + 10}
              returnKeyType="done"
              onSubmitEditing={submit}
              accessibilityLabel="Pattern name"
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
              Saved on this phone only. Grid size {pattern.rows} × {pattern.cols} is stored with the pattern.
            </Label>
          )}
          <PinGrid pattern={pattern} />
        </View>
      </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: space.xl },
  dialog: {
    width: '100%',
    maxWidth: 520,
    borderRadius: radius.xl,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 12 },
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    height: 56,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  barButton: { minWidth: 64, minHeight: 44, justifyContent: 'center' },
  body: { padding: space.lg, gap: space.md },
  field: { borderRadius: radius.md },
  input: { minHeight: 50, paddingHorizontal: space.lg },
});
