import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  type ScrollViewProps,
  StyleSheet,
  Text,
  type TextProps,
  View,
  type ViewStyle,
} from 'react-native';

import { ConnectionPill } from './ConnectionPill';
import { Icon, type IconName } from './Icon';
import { MAX_CONTENT_WIDTH, useResponsive } from './layout';
import { MIN_TOUCH, radius, space, type, useTheme } from './theme';

export function tapFeedback() {
  if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
}

// ---------- Layout ----------

/**
 * Scrollable page. Content is centred and capped at MAX_CONTENT_WIDTH so it
 * reads well on laptops. On web there is no native navigation bar, so the
 * page draws its own large title (and the connection pill when there is no
 * sidebar showing it).
 */
export function Screen({ children, title, ...rest }: ScrollViewProps & { children: ReactNode; title: string }) {
  const t = useTheme();
  const { gutter, sidebar } = useResponsive();
  const web = Platform.OS === 'web';
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ flex: 1, backgroundColor: t.background }}
      contentContainerStyle={[styles.screenContent, { paddingHorizontal: gutter, paddingTop: web ? gutter : space.lg }]}
      keyboardShouldPersistTaps="handled"
      {...rest}>
      <View style={styles.screenInner}>
        {web ? (
          <View style={styles.webHeader}>
            <Text accessibilityRole="header" aria-level={1} style={[type.largeTitle, { color: t.text, flex: 1 }]} numberOfLines={1}>
              {title}
            </Text>
            {!sidebar ? <ConnectionPill /> : null}
          </View>
        ) : null}
        {children}
      </View>
    </ScrollView>
  );
}

/** Two columns side by side on wide screens, stacked on phones. */
export function Columns({ left, right, rightWidth = 380 }: { left: ReactNode; right: ReactNode; rightWidth?: number }) {
  const { twoColumn } = useResponsive();
  if (!twoColumn) {
    return (
      <>
        {left}
        {right}
      </>
    );
  }
  return (
    <View style={styles.columns}>
      <View style={styles.columnMain}>{left}</View>
      <View style={[styles.columnSide, { width: rightWidth }]}>{right}</View>
    </View>
  );
}

export function Section({
  title,
  footer,
  children,
  padded = true,
  style,
}: {
  title?: string;
  footer?: ReactNode;
  children: ReactNode;
  padded?: boolean;
  style?: ViewStyle;
}) {
  const t = useTheme();
  return (
    <View style={[styles.section, style]}>
      {title ? (
        <Text accessibilityRole="header" style={[type.footnote, styles.sectionTitle, { color: t.textSecondary }]}>
          {title.toUpperCase()}
        </Text>
      ) : null}
      <View style={[styles.card, { backgroundColor: t.card }, padded && styles.cardPadded]}>{children}</View>
      {footer ? (
        <Text style={[type.footnote, styles.sectionFooter, { color: t.textSecondary }]}>{footer}</Text>
      ) : null}
    </View>
  );
}

export function Label({ style, variant = 'body', secondary, ...rest }: TextProps & { variant?: keyof typeof type; secondary?: boolean }) {
  const t = useTheme();
  return <Text style={[type[variant], { color: secondary ? t.textSecondary : t.text }, style]} {...rest} />;
}

export function Separator({ inset = 0 }: { inset?: number }) {
  const t = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.separator, marginLeft: inset }} />;
}

// ---------- Buttons ----------

type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'plain';

export function Button({
  title,
  onPress,
  variant = 'primary',
  icon,
  disabled,
  loading,
  accessibilityHint,
  accessibilityLabel,
  compact,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  accessibilityHint?: string;
  accessibilityLabel?: string;
  compact?: boolean;
  style?: ViewStyle;
}) {
  const t = useTheme();
  const colors: Record<ButtonVariant, { bg: string; fg: string }> = {
    primary: { bg: t.tint, fg: t.onTint },
    secondary: { bg: t.tintSoft, fg: t.tint },
    destructive: { bg: t.destructiveSoft, fg: t.destructive },
    plain: { bg: 'transparent', fg: t.tint },
  };
  const inactive = disabled || loading;
  // Disabled buttons switch to neutral colours (not just fading) so the label keeps its contrast.
  const { bg, fg } = disabled ? { bg: variant === 'plain' ? 'transparent' : t.fill, fg: t.textSecondary } : colors[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={() => {
        tapFeedback();
        onPress();
      }}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.button,
        compact && styles.buttonCompact,
        { backgroundColor: bg, opacity: pressed ? 0.72 : hovered && !inactive ? 0.86 : 1 },
        style,
      ]}>
      {loading ? <ActivityIndicator color={fg} /> : icon ? <Icon name={icon} color={fg} size={compact ? 17 : 19} /> : null}
      {title ? (
        <Text style={[type.headline, { color: fg }]} numberOfLines={1} adjustsFontSizeToFit>
          {title}
        </Text>
      ) : null}
    </Pressable>
  );
}

// ---------- Status ----------

export type Tone = 'neutral' | 'progress' | 'success' | 'error' | 'warning';

/** Status message that always pairs an icon/spinner and a text title with its colour. */
export function StatusBanner({ tone, title, message, action }: { tone: Tone; title: string; message?: string; action?: ReactNode }) {
  const t = useTheme();
  const map: Record<Tone, { fg: string; bg: string; icon: IconName | null }> = {
    neutral: { fg: t.textSecondary, bg: t.fill, icon: 'info' },
    progress: { fg: t.tint, bg: t.tintSoft, icon: null },
    success: { fg: t.success, bg: t.successSoft, icon: 'success' },
    error: { fg: t.destructive, bg: t.destructiveSoft, icon: 'error' },
    warning: { fg: t.warning, bg: t.warningSoft, icon: 'error' },
  };
  const { fg, bg, icon } = map[tone];
  return (
    <View
      accessible
      accessibilityRole={tone === 'error' ? 'alert' : 'summary'}
      accessibilityLiveRegion={tone === 'error' ? 'assertive' : 'polite'}
      accessibilityLabel={`${title}. ${message ?? ''}`}
      style={[styles.banner, { backgroundColor: bg }]}>
      <View style={styles.bannerRow}>
        <View style={styles.bannerIcon}>{icon ? <Icon name={icon} color={fg} size={20} /> : <ActivityIndicator color={fg} />}</View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[type.headline, { color: tone === 'neutral' ? t.text : fg }]}>{title}</Text>
          {message ? <Text style={[type.subhead, { color: t.text }]}>{message}</Text> : null}
        </View>
      </View>
      {action ? <View style={{ marginTop: space.md }}>{action}</View> : null}
    </View>
  );
}

// ---------- Segmented control ----------

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  disabled,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  accessibilityLabel: string;
  disabled?: boolean;
}) {
  const t = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel} style={[styles.segTrack, { backgroundColor: t.fill }]}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityLabel={o.label}
            accessibilityState={{ selected, checked: selected, disabled }}
            disabled={disabled}
            onPress={() => {
              if (!selected) {
                tapFeedback();
                onChange(o.value);
              }
            }}
            style={[styles.segItem, selected && [styles.segSelected, { backgroundColor: t.card }], disabled && { opacity: 0.5 }]}>
            <Text style={[type.subhead, { color: t.text, fontWeight: selected ? '600' : '500' }]} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------- List row ----------

export function Row({
  title,
  detail,
  right,
  onPress,
  accessibilityLabel,
  accessibilityHint,
}: {
  title: string;
  detail?: string;
  right?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}) {
  const t = useTheme();
  const content = (
    <>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.body, { color: t.text }]}>{title}</Text>
        {detail ? <Text style={[type.subhead, { color: t.textSecondary }]}>{detail}</Text> : null}
      </View>
      {right}
    </>
  );
  if (!onPress) {
    return (
      <View style={styles.row} accessible accessibilityLabel={accessibilityLabel ?? [title, detail].filter(Boolean).join(', ')}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? [title, detail].filter(Boolean).join(', ')}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.row, (pressed || hovered) && { backgroundColor: t.cardPressed }]}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screenContent: { paddingBottom: 48, alignItems: 'center' },
  screenInner: { width: '100%', maxWidth: MAX_CONTENT_WIDTH, gap: space.xl },
  webHeader: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48 },
  columns: { flexDirection: 'row', alignItems: 'flex-start', gap: space.xl },
  columnMain: { flex: 1, minWidth: 0, gap: space.xl },
  columnSide: { gap: space.xl },
  section: { gap: space.sm },
  sectionTitle: { marginLeft: space.lg, fontWeight: '500' },
  sectionFooter: { marginHorizontal: space.lg },
  card: { borderRadius: radius.lg, overflow: 'hidden' },
  cardPadded: { padding: space.lg, gap: space.md },
  button: {
    minHeight: 52,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  buttonCompact: { minHeight: MIN_TOUCH, paddingHorizontal: space.md, borderRadius: radius.sm + 2 },
  banner: { borderRadius: radius.md, padding: space.md + 2 },
  bannerRow: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  bannerIcon: { width: 22, alignItems: 'center', paddingTop: 1 },
  segTrack: { flexDirection: 'row', borderRadius: radius.sm + 1, padding: 2 },
  segItem: { flex: 1, minHeight: MIN_TOUCH - 4, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm - 1, paddingHorizontal: space.sm },
  segSelected: {
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  row: { minHeight: MIN_TOUCH + 8, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md },
});
