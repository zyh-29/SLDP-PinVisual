import { TabList, TabSlot, TabTrigger, type TabTriggerSlotProps, Tabs } from 'expo-router/ui';
import type { ComponentProps, ReactNode } from 'react';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native';

import { useDevice } from '@/state/DeviceProvider';
import { connectionSummary } from './ConnectionPill';
import { Icon, type IconName } from './Icon';
import { SIDEBAR_WIDTH, useResponsive } from './layout';
import { radius, space, type, useTheme } from './theme';

const TABS: { name: string; href: '/' | '/image' | '/saved' | '/pin-test' | '/device'; label: string; icon: IconName }[] = [
  { name: '(display)', href: '/', label: 'Display', icon: 'grid' },
  { name: 'image', href: '/image', label: 'Image', icon: 'photo' },
  { name: 'saved', href: '/saved', label: 'Saved', icon: 'bookmarks' },
  { name: 'pin-test', href: '/pin-test', label: 'Pin Test', icon: 'pin' },
  { name: 'device', href: '/device', label: 'Device', icon: 'bluetooth' },
];

/**
 * Web navigation. Laptop-width browsers get a macOS-style sidebar; narrow
 * browsers (phones) get a bottom tab bar like the native app.
 */
export function AppTabs() {
  const t = useTheme();
  const { sidebar } = useResponsive();

  const list = (
    <TabList
      style={
        sidebar
          ? [styles.sidebar, { backgroundColor: t.sidebar, borderRightColor: t.separator }]
          : [styles.bottomBar, { backgroundColor: t.card, borderTopColor: t.separator }]
      }>
      {sidebar ? <SidebarHeader /> : null}
      {TABS.map((tab) => (
        <TabTrigger key={tab.name} name={tab.name} href={tab.href} asChild>
          <NavItem icon={tab.icon} compact={!sidebar}>
            {tab.label}
          </NavItem>
        </TabTrigger>
      ))}
      {sidebar ? <SidebarStatus /> : null}
    </TabList>
  );

  return (
    <Tabs style={{ flex: 1, flexDirection: sidebar ? 'row' : 'column', backgroundColor: t.background }}>
      {sidebar ? list : null}
      <TabSlot style={{ flex: 1 }} />
      {!sidebar ? list : null}
    </Tabs>
  );
}

type NavItemProps = TabTriggerSlotProps & {
  icon: IconName;
  compact: boolean;
  children: ReactNode;
  ref?: ComponentProps<typeof Pressable>['ref'];
};

// TabTrigger (asChild) passes ref, onPress and isFocused down to this component.
function NavItem({ icon, compact, children, isFocused, ref, ...props }: NavItemProps) {
    const t = useTheme();
    const color = isFocused ? t.tint : compact ? t.textSecondary : t.text;
    return (
      <Pressable
        ref={ref}
        {...props}
        accessibilityRole="link"
        aria-current={isFocused ? 'page' : undefined}
        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
          compact ? styles.tabItem : styles.navItem,
          !compact && isFocused && { backgroundColor: t.tintSoft },
          !compact && !isFocused && (hovered || pressed) && { backgroundColor: t.fill },
          compact && pressed && { opacity: 0.6 },
        ]}>
        <Icon name={icon} color={color} size={compact ? 24 : 20} />
        <Text
          style={[
            compact ? type.caption : type.body,
            { color, fontWeight: isFocused ? '600' : compact ? '500' : '400' },
          ]}>
          {children}
        </Text>
      </Pressable>
    );
}

/** The PinVisual logo: a version with lighter colours on dark backgrounds, where the navy "Pin" would vanish. */
const LOGO = { light: require('@/assets/images/logo.svg'), dark: require('@/assets/images/logo-dark.svg') };
/** The logo's own proportions (assets/images/logo.svg is 1074 by 282). */
const LOGO_WIDTH = 208;
const LOGO_HEIGHT = Math.round((LOGO_WIDTH * 282) / 1074);

function SidebarHeader() {
  const dark = useColorScheme() === 'dark';
  return (
    <View style={styles.brand}>
      <Image
        source={dark ? LOGO.dark : LOGO.light}
        style={{ width: LOGO_WIDTH, height: LOGO_HEIGHT }}
        contentFit="contain"
        accessible
        accessibilityRole="image"
        accessibilityLabel="PinVisual: images into touch"
      />
    </View>
  );
}

/** Connection status pinned to the bottom of the sidebar. */
function SidebarStatus() {
  const t = useTheme();
  const { state } = useDevice();
  const s = connectionSummary(state.connection);
  const fg = s.kind === 'real' ? t.success : s.kind === 'busy' ? t.tint : t.textSecondary;
  const icon: IconName = s.kind === 'real' ? 'connected' : s.kind === 'busy' ? 'connecting' : 'disconnected';
  return (
    <View
      style={[styles.status, { backgroundColor: t.card, borderColor: t.separator }]}
      accessible
      accessibilityRole="summary"
      accessibilityLiveRegion="polite"
      accessibilityLabel={`Connection status: ${s.long}`}>
      <Icon name={icon} color={fg} size={18} />
      <View style={{ flex: 1 }}>
        <Text style={[type.subhead, { color: fg, fontWeight: '600' }]}>{s.short}</Text>
        <Text style={[type.caption, { color: t.textSecondary }]} numberOfLines={2}>
          {s.kind === 'real' && state.connection.status === 'connected' ? state.connection.deviceName : 'Open Device to connect'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    width: SIDEBAR_WIDTH,
    flexDirection: 'column',
    paddingHorizontal: space.md,
    paddingVertical: space.lg,
    gap: 2,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  bottomBar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingBottom: 6,
  },
  brand: { paddingHorizontal: space.sm, paddingTop: space.xs, paddingBottom: space.xl },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 40,
    paddingHorizontal: space.md,
    borderRadius: radius.sm,
  },
  tabItem: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, minHeight: 56, paddingTop: 6 },
  status: {
    marginTop: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
