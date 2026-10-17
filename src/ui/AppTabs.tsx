import { NativeTabs } from 'expo-router/native-tabs';

import { useTheme } from './theme';

/** Native iOS / Android tab bar. The web version lives in AppTabs.web.tsx. */
export function AppTabs() {
  const t = useTheme();
  return (
    <NativeTabs tintColor={t.tint}>
      <NativeTabs.Trigger name="(display)">
        <NativeTabs.Trigger.Label>Display</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'circle.grid.3x3', selected: 'circle.grid.3x3.fill' }} md="grid_on" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="image">
        <NativeTabs.Trigger.Label>Image</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'photo', selected: 'photo.fill' }} md="image" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="saved">
        <NativeTabs.Trigger.Label>Saved</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'square.stack', selected: 'square.stack.fill' }} md="bookmarks" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="device">
        <NativeTabs.Trigger.Label>Device</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="antenna.radiowaves.left.and.right" md="bluetooth" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
