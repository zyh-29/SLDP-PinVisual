import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';

import { DeviceProvider } from '@/state/DeviceProvider';
import { PatternProvider } from '@/state/PatternProvider';
// Resolves to AppTabs.web.tsx in the browser.
import { AppTabs } from '@/ui/AppTabs';
import { DialogHost } from '@/ui/dialogs';
// Website only: page-wide styles (no selecting text with the mouse).
import '@/ui/webPage';

export default function RootLayout() {
  const scheme = useColorScheme();
  return (
    <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      <DeviceProvider>
        <PatternProvider>
          <StatusBar style="auto" />
          <AppTabs />
          <DialogHost />
        </PatternProvider>
      </DeviceProvider>
    </ThemeProvider>
  );
}
