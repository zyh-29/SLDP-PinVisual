import { Stack } from 'expo-router';
import { Platform } from 'react-native';

import { ConnectionPill } from './ConnectionPill';
import { useTheme } from './theme';

/** Each tab gets a native stack with a large title and the connection pill on the right. */
export function TabStack({ title }: { title: string }) {
  const t = useTheme();
  return (
    <Stack
      screenOptions={{
        // Web pages draw their own title (see Screen); native uses the system large-title bar.
        headerShown: Platform.OS !== 'web',
        headerLargeTitleEnabled: true,
        headerShadowVisible: false,
        headerLargeTitleShadowVisible: false,
        // iOS draws the system (translucent) bar itself; Android needs an explicit colour.
        ...(Platform.OS === 'ios' ? {} : { headerStyle: { backgroundColor: t.background } }),
        headerTintColor: t.tint,
        headerTitleStyle: { color: t.text },
        headerLargeTitleStyle: { color: t.text },
        headerRight: () => <ConnectionPill />,
        contentStyle: { backgroundColor: t.background },
      }}>
      <Stack.Screen name="index" options={{ title }} />
    </Stack>
  );
}
