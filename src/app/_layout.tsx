import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';

import { DeviceProvider } from '@/state/DeviceProvider';
import { PatternProvider } from '@/state/PatternProvider';
// Resolves to AppTabs.web.tsx in the browser.
import { AppTabs } from '@/ui/AppTabs';

export default function RootLayout() {
  const scheme = useColorScheme();
  return (
    <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      <DeviceProvider>
        <PatternProvider>
          <StatusBar style="auto" />
          <AppTabs />
        </PatternProvider>
      </DeviceProvider>
    </ThemeProvider>
  );
}
