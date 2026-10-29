import { Alert } from 'react-native';

import type { IconName } from './Icon';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  /** The website's alert shows an icon: a warning for destructive actions and an info sign otherwise, unless given. */
  icon?: IconName;
}

/**
 * Asks the user to confirm, with the system alert (iOS, Android). The website draws its own alert instead
 * (dialogs.web.tsx): React Native's Alert does nothing there.
 */
export function confirmAsync(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      options.title,
      options.message,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: options.confirmLabel, style: options.destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

/** Where the website draws its alerts. The phone app uses the system's, so nothing here. */
export function DialogHost() {
  return null;
}
