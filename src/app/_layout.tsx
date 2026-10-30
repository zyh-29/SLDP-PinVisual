import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { DeviceProvider } from '@/state/DeviceProvider';
import { PatternProvider } from '@/state/PatternProvider';
// Resolves to AppTabs.web.tsx in the browser.
import { AppTabs } from '@/ui/AppTabs';
import { DialogHost } from '@/ui/dialogs';
import { VoiceProvider } from '@/voice/VoiceProvider';
import { useScheme } from '@/ui/theme';
// Website only: page-wide styles (no selecting text with the mouse).
import '@/ui/webPage';

export default function RootLayout() {
  const scheme = useScheme();
  return (
    <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      <DeviceProvider>
        <PatternProvider>
          <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
          <VoiceProvider>
            <AppTabs />
          </VoiceProvider>
          <DialogHost />
        </PatternProvider>
      </DeviceProvider>
    </ThemeProvider>
  );
}
