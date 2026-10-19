import { router } from 'expo-router';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text } from 'react-native';

import type { ConnectionState } from '@/device/DeviceController';
import { useDevice } from '@/state/DeviceProvider';
import { Icon, type IconName } from './Icon';
import { radius, type, useTheme } from './theme';

/** iOS 26+ wraps header items in its own glass capsule, so the pill drops its background there. */
const SYSTEM_DRAWS_CAPSULE = Platform.OS === 'ios' && parseInt(String(Platform.Version), 10) >= 26;

export function connectionSummary(c: ConnectionState): { short: string; long: string; kind: 'off' | 'busy' | 'real' } {
  switch (c.status) {
    case 'disconnected':
      return { short: 'Not Connected', long: 'No board connected', kind: 'off' };
    case 'connecting':
      return { short: 'Connecting…', long: `Connecting to ${c.deviceName}`, kind: 'busy' };
    case 'connected':
      return { short: 'Connected', long: `Connected to board ${c.deviceName}`, kind: 'real' };
  }
}

/** Always-visible connection status for the navigation bar. Tapping opens the Device tab. */
export function ConnectionPill() {
  const t = useTheme();
  const { state } = useDevice();
  const s = connectionSummary(state.connection);
  const palette = {
    off: { fg: t.textSecondary, bg: t.fill, icon: 'disconnected' as IconName },
    busy: { fg: t.tint, bg: t.tintSoft, icon: null },
    real: { fg: t.success, bg: t.successSoft, icon: 'connected' as IconName },
  }[s.kind];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Connection status: ${s.long}`}
      accessibilityHint="Opens the Device tab"
      onPress={() => router.navigate('/device')}
      hitSlop={8}
      style={({ pressed }) => [
        styles.pill,
        { backgroundColor: SYSTEM_DRAWS_CAPSULE ? 'transparent' : palette.bg, opacity: pressed ? 0.7 : 1 },
      ]}>
      {palette.icon ? <Icon name={palette.icon} color={palette.fg} size={14} /> : <ActivityIndicator size="small" color={palette.fg} />}
      <Text style={[type.footnote, styles.text, { color: palette.fg }]}>{s.short}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    minHeight: 30,
    borderRadius: radius.pill,
  },
  text: { fontWeight: '600' },
});
