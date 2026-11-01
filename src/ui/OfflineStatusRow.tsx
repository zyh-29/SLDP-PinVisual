import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { type OfflineStatus, offlineStatus, watchOffline } from '@/offline/serviceWorker';
import { Row, Section } from './components';

const TEXT: Record<Exclude<OfflineStatus, 'app'>, string> = {
  development: 'Off while developing (the development server always serves the latest code).',
  unsupported: 'Not available in this browser. Use a current browser on an https:// address.',
  saving: 'Saving a copy of the app on this device…',
  ready: 'Ready: the app opens without internet. Smart Cut-Out and graph numbers are still being saved.',
  complete: 'Ready: the app, Smart Cut-Out and graph numbers all work without internet.',
};

/** Website only: whether the site has saved itself on this device to work offline. */
export function OfflineStatusRow() {
  const [status, setStatus] = useState<OfflineStatus | null>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let live = true;
    let stop = () => {};
    const check = () => {
      offlineStatus().then((s) => {
        if (!live) return;
        setStatus(s);
        if (s === 'complete') stop(); // nothing left to wait for
      });
    };
    stop = watchOffline(check);
    check();
    return () => {
      live = false;
      stop();
    };
  }, []);
  if (Platform.OS !== 'web' || !status || status === 'app') return null;
  return (
    <Section
      title="Offline"
      padded={false}
      footer="The website keeps a copy of itself on this device after the first visit. Updates download automatically and take over the next time you open it. Picture search and online speech recognition still need the internet.">
      <Row title="Works without internet" detail={TEXT[status]} />
    </Section>
  );
}
