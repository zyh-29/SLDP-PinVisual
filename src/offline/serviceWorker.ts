/**
 * Offline support for the website (see serviceWorker.web.ts). The phone apps carry everything with them and work
 * offline already, so there's nothing to do here.
 */
export type OfflineStatus =
  /** Phone app: always works offline. */
  | 'app'
  /** Development server: the service worker is off so code changes show at once. */
  | 'development'
  /** This browser can't keep a copy (no service workers, or not an https:// page). */
  | 'unsupported'
  /** Being saved now. */
  | 'saving'
  /** The app is saved; the engines (Smart Cut-Out, number reader) aren't yet. */
  | 'ready'
  /** The app and its engines are saved. */
  | 'complete';

export async function offlineStatus(): Promise<OfflineStatus> {
  return 'app';
}

/** Calls `onChange` when the status may have changed. Returns a function that stops it. */
export function watchOffline(_onChange: () => void): () => void {
  return () => {};
}
