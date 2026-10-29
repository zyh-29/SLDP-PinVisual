import { AccessibilityInfo } from 'react-native';

import { type AppearancePref, useAppearance } from '@/state/appearance';
import { SegmentedControl } from './components';

const NAMES: Record<AppearancePref, string> = { auto: 'Automatic', light: 'Light', dark: 'Dark' };

/**
 * Automatic · Light · Dark. Automatic (the default) follows the device, as Apple recommends; the other two are for
 * when the app must look one way whatever the device says (a demo on a projector, a borrowed laptop).
 * `compact` shortens Automatic to Auto, for the website's sidebar.
 */
export function AppearancePicker({ compact }: { compact?: boolean }) {
  const [pref, setPref] = useAppearance();
  return (
    <SegmentedControl<AppearancePref>
      accessibilityLabel="Appearance"
      value={pref}
      onChange={(p) => {
        setPref(p);
        AccessibilityInfo.announceForAccessibility(`Appearance: ${NAMES[p]}`);
      }}
      options={[
        { value: 'auto', label: compact ? 'Auto' : NAMES.auto },
        { value: 'light', label: NAMES.light },
        { value: 'dark', label: NAMES.dark },
      ]}
    />
  );
}
