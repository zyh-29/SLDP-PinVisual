/**
 * "Send Live to Board": while on (and a board is connected), the pins of a live screen share or camera go to
 * the board as they change, paced for the servos (see LiveSender).
 */
import { useEffect, useRef, useState } from 'react';

import type { Pattern } from '@/domain/pattern';
import { LiveSender, type LiveSendStatus } from '@/device/LiveSender';
import { useDevice } from './DeviceProvider';

export function useLiveSend(on: boolean, pattern: Pattern | null) {
  const { controller, state } = useDevice();
  const connected = state.connection.status === 'connected';
  const active = on && connected;
  // The status belongs to one sending session: switching off (or disconnecting) forgets it, so an old error
  // isn't shown after reconnecting. A stopped sender never reports again (LiveSender.stop).
  const [session, setSession] = useState<{ active: boolean; status: LiveSendStatus | null }>({ active, status: null });
  if (session.active !== active) setSession({ active, status: null });
  const status = session.active === active ? session.status : null;
  const sender = useRef<LiveSender | null>(null);
  useEffect(() => {
    if (!active) return;
    const s = new LiveSender(controller, (st) => setSession((prev) => ({ ...prev, status: st })));
    sender.current = s;
    return () => {
      s.stop();
      sender.current = null;
    };
  }, [active, controller]);
  useEffect(() => {
    if (active && pattern) sender.current?.push(pattern);
  }, [active, pattern]);
  return { connected, active, error: active ? (status?.lastError ?? null) : null };
}
