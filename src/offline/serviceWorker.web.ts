/**
 * Offline support for the website: registers the service worker (dist/sw.js, written at build time by
 * scripts/web-offline.mjs from scripts/service-worker.js), which keeps a copy of the app in the browser so it
 * opens and works with no internet. Imported once by the root layout.
 */
import { APP_BASE } from '@/imaging/webScript';
import type { OfflineStatus } from './serviceWorker';

export type { OfflineStatus };

const supported = () => typeof navigator !== 'undefined' && 'serviceWorker' in navigator && window.isSecureContext;

if (!__DEV__ && supported()) {
  // After the page has loaded, so saving the app never slows down opening it.
  const register = () =>
    navigator.serviceWorker.register(`${APP_BASE}/sw.js`, { scope: `${APP_BASE}/` }).catch((e: unknown) => {
      console.warn('Offline copy unavailable:', e);
    });
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

/** The cut-out model: the largest engine file and the last to be saved. */
const ENGINE_FILE = `${APP_BASE}/models/u2netp.onnx`;

export async function offlineStatus(): Promise<OfflineStatus> {
  if (__DEV__) return 'development';
  if (!supported()) return 'unsupported';
  const reg = await navigator.serviceWorker.getRegistration(`${APP_BASE}/`);
  if (!reg?.active) return 'saving';
  try {
    const engines = await caches.match(new URL(ENGINE_FILE, window.location.href).href);
    return engines ? 'complete' : 'ready';
  } catch {
    return 'ready';
  }
}

/** Calls `onChange` when the status may have changed (the copy finished saving, an update took over). */
export function watchOffline(onChange: () => void): () => void {
  if (__DEV__ || !supported()) return () => {};
  const sw = navigator.serviceWorker;
  sw.addEventListener('controllerchange', onChange);
  // The engines are saved in the background with no event to say so: look again now and then until they are.
  const timer = setInterval(onChange, 5000);
  return () => {
    sw.removeEventListener('controllerchange', onChange);
    clearInterval(timer);
  };
}
