import { useEffect, useState } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native';

import type { ConfirmOptions } from './dialogs';
import { Icon } from './Icon';
import { radius, space, type, useTheme } from './theme';

export type { ConfirmOptions } from './dialogs';

/**
 * The website's alerts, drawn by the app in the style of an iOS / macOS alert instead of the browser's own
 * confirm box ("localhost says…"). confirmAsync puts a question in the queue; DialogHost, mounted once at the
 * root, shows them one at a time.
 */
interface Pending extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

let queue: Pending[] = [];
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

export function confirmAsync(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    queue = [...queue, { ...options, resolve }];
    changed();
  });
}

/** Filled-button colours in dark mode: white text on them is at least 4.5:1. */
const DARK_RED = '#C4302A';
const DARK_BLUE = '#0A64C8';

const CANCEL_ID = 'pv-alert-cancel';
const CONFIRM_ID = 'pv-alert-confirm';

function answer(ok: boolean) {
  const [first, ...rest] = queue;
  if (!first) return;
  queue = rest;
  changed();
  first.resolve(ok);
}

export function DialogHost() {
  const [current, setCurrent] = useState<Pending | undefined>(queue[0]);
  useEffect(() => {
    const update = () => setCurrent(queue[0]);
    listeners.add(update);
    update();
    return () => {
      listeners.delete(update);
    };
  }, []);
  if (!current) return null;
  return <Alert key={queue.length + current.title} request={current} />;
}

function Alert({ request }: { request: Pending }) {
  const t = useTheme();
  const { title, message, confirmLabel, destructive, icon } = request;
  const dark = useColorScheme() === 'dark';
  const [appear] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.timing(appear, { toValue: 1, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    // Like Apple's alerts: a destructive action is never the default, so focus starts on Cancel.
    const focus = () => document.getElementById(destructive ? CANCEL_ID : CONFIRM_ID)?.focus();
    const id = setTimeout(focus, 0);
    return () => clearTimeout(id);
  }, [appear, destructive]);

  // Escape cancels; Return confirms, unless the action is destructive (then it presses the focused button).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        answer(false);
      } else if (e.key === 'Enter' && !destructive && !(e.target instanceof HTMLElement && e.target.getAttribute('role') === 'button')) {
        e.preventDefault();
        answer(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [destructive]);

  const accent = destructive ? t.destructive : t.tint;
  // The filled button: white text needs a deeper red (or blue) than the dark theme's text colours to stay readable.
  const fill = destructive ? (dark ? DARK_RED : t.destructive) : dark ? DARK_BLUE : t.tint;
  return (
    <Modal transparent visible animationType="none" onRequestClose={() => answer(false)}>
      <Animated.View style={[styles.backdrop, { opacity: appear }]}>
        <Animated.View
          role="alertdialog"
          aria-modal
          aria-labelledby="pv-alert-title"
          aria-describedby="pv-alert-message"
          style={[
            styles.card,
            { backgroundColor: t.card, borderColor: t.separator },
            { transform: [{ scale: appear.interpolate({ inputRange: [0, 1], outputRange: [1.08, 1] }) }] },
          ]}>
          <View style={styles.body}>
            <View style={[styles.badge, { backgroundColor: destructive ? t.destructiveSoft : t.tintSoft }]}>
              <Icon name={icon ?? (destructive ? 'error' : 'info')} color={accent} size={22} />
            </View>
            <Text nativeID="pv-alert-title" style={[type.headline, styles.center, { color: t.text }]}>
              {title}
            </Text>
            <Text nativeID="pv-alert-message" style={[type.footnote, styles.center, { color: t.textSecondary }]}>
              {message}
            </Text>
          </View>
          <View style={styles.buttons}>
            <AlertButton id={CANCEL_ID} label="Cancel" onPress={() => answer(false)} color={t.text} fill={t.fill} hover={t.cardPressed} />
            <AlertButton
              id={CONFIRM_ID}
              label={confirmLabel}
              onPress={() => answer(true)}
              color="#FFFFFF"
              fill={fill}
              hover={fill}
              strong
            />
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

function AlertButton({
  id,
  label,
  onPress,
  color,
  fill,
  hover,
  strong,
}: {
  id: string;
  label: string;
  onPress: () => void;
  color: string;
  fill: string;
  hover: string;
  strong?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      nativeID={id}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed, hovered, focused }: { pressed: boolean; hovered?: boolean; focused?: boolean }) => [
        styles.button,
        {
          backgroundColor: hovered && !strong ? hover : fill,
          opacity: pressed ? 0.7 : hovered && strong ? 0.88 : 1,
          // A visible ring for keyboard focus, in the tint colour.
          outlineColor: t.tint,
          outlineWidth: focused ? 2 : 0,
          outlineOffset: 2,
          outlineStyle: 'solid',
        } as object,
      ]}>
      <Text style={[type.body, { color, fontWeight: strong ? '600' : '500' }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
    backgroundColor: 'rgba(0,0,0,0.32)',
    backdropFilter: 'blur(6px)',
  } as object,
  card: {
    width: '100%',
    maxWidth: 320,
    borderRadius: radius.lg + 2,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.lg + 4,
    paddingTop: space.xl,
    gap: space.lg + 4,
    boxShadow: '0 20px 50px rgba(0,0,0,0.28), 0 2px 8px rgba(0,0,0,0.12)',
  } as object,
  body: { alignItems: 'center', gap: space.sm },
  badge: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginBottom: space.xs },
  center: { textAlign: 'center' },
  buttons: { flexDirection: 'row', gap: space.sm + 2 },
  button: { flex: 1, minHeight: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.md },
});
