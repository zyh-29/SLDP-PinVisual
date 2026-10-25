import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { useResponsive } from './layout';
import { SheetBar } from './SheetBar';
import { radius, space, useTheme } from './theme';

/**
 * A page sheet with a scrolling body: a centred dialog in wide browsers, the iOS-style sheet on phones. Open it by
 * rendering it; close it by not rendering it (so each opening starts fresh).
 */
export function Sheet({
  title,
  action,
  busy = false,
  onCancel,
  onAction,
  children,
}: {
  title: string;
  action: string;
  busy?: boolean;
  /** Left out: no Cancel button (the action closes the sheet). */
  onCancel?: () => void;
  onAction: () => void;
  children: ReactNode;
}) {
  const t = useTheme();
  const { width } = useResponsive();
  const dialog = Platform.OS === 'web' && width >= 600;
  return (
    <Modal
      visible
      animationType={dialog ? 'fade' : 'slide'}
      presentationStyle={dialog ? 'overFullScreen' : 'pageSheet'}
      transparent={dialog}
      onRequestClose={onCancel ?? onAction}>
      <View style={dialog ? styles.backdrop : { flex: 1 }}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[{ backgroundColor: t.background }, dialog ? styles.dialog : { flex: 1 }]}
          aria-modal
          role="dialog">
          <SheetBar title={title} action={action} busy={busy} onCancel={onCancel} onAction={onAction} />
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: space.xl },
  dialog: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '92%',
    borderRadius: radius.xl,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 12 },
  },
  body: { padding: space.lg, gap: space.md },
});
