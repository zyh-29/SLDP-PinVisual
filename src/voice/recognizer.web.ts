/**
 * Browser version of recognizer.ts: the Web Speech API. Chrome on computers can recognise speech on the computer
 * itself (it downloads the language once, about 50 MB, the first time). Elsewhere (Chrome on Android, Safari, Edge)
 * the browser sends the audio to its maker's servers, which the app allows only when the user turned on Online
 * Speech Recognition. Firefox has no speech recognition.
 */
import type { ListenResult, RecognitionSupport } from './recognizer';

export type { ListenResult, RecognitionSupport };

type Availability = 'available' | 'downloadable' | 'downloading' | 'unavailable';
interface LangOptions {
  langs: string[];
  processLocally?: boolean;
  quality?: 'command' | 'dictation' | 'conversation';
}
interface Alternative {
  transcript: string;
}
interface RecognitionEvent {
  results: ArrayLike<ArrayLike<Alternative> & { isFinal: boolean }>;
}
interface RecognitionError {
  error: string;
  message?: string;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  processLocally?: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: RecognitionError) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
interface RecognitionClass {
  new (): Recognition;
  available?: (o: LangOptions) => Promise<Availability>;
  install?: (o: LangOptions) => Promise<boolean>;
}

const LANG = 'en-US';

function recognitionClass(): RecognitionClass | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionClass; webkitSpeechRecognition?: RecognitionClass };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Whether this browser can recognise the language on the device: now, after a download, or not at all. */
async function onDeviceStatus(C: RecognitionClass, lang: string): Promise<Availability> {
  if (!C.available) return 'unavailable';
  try {
    return await C.available({ langs: [lang], processLocally: true, quality: 'command' });
  } catch {
    try {
      return await C.available({ langs: [lang], processLocally: true });
    } catch {
      return 'unavailable';
    }
  }
}

export async function recognitionSupport(): Promise<RecognitionSupport> {
  const C = recognitionClass();
  if (!C) return { available: false, onDevice: false };
  return { available: true, onDevice: (await onDeviceStatus(C, LANG)) !== 'unavailable' };
}

let active: Recognition | null = null;

export function finishListening() {
  active?.stop();
}

export function cancelListening() {
  active?.abort();
}

const LISTEN_LIMIT_MS = 15_000;

export async function listen(o: {
  allowOnline: boolean;
  hints: string[];
  lang?: string;
  onStatus?: (s: 'downloading' | 'listening') => void;
}): Promise<ListenResult> {
  const lang = o.lang ?? LANG;
  const C = recognitionClass();
  if (!C)
    return {
      ok: false,
      reason: 'unavailable',
      message: 'This browser has no speech recognition. Use Chrome, Edge or Safari, or type the command instead.',
    };
  let local = await onDeviceStatus(C, lang);
  if ((local === 'downloadable' || local === 'downloading') && C.install) {
    // Once per browser: the language for on-device recognition.
    o.onStatus?.('downloading');
    try {
      local = (await C.install({ langs: [lang], processLocally: true })) ? 'available' : local;
    } catch {
      // Stays as it was; below, online recognition (if allowed) or a message.
    }
  }
  const onDevice = local === 'available';
  if (!onDevice && !o.allowOnline)
    return {
      ok: false,
      reason: 'needs-online',
      message:
        'This browser can only recognise speech on its maker’s servers. To allow that, turn on Online Speech Recognition in the Device tab, or type the command instead.',
    };

  return new Promise<ListenResult>((resolve) => {
    const rec = new C();
    rec.lang = lang;
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 5;
    if (onDevice) rec.processLocally = true;
    let transcripts: string[] = [];
    let failed: ListenResult | null = null;
    rec.onresult = (e) => {
      const last = e.results[e.results.length - 1];
      transcripts = Array.from(last ?? [], (a) => a.transcript.trim()).filter(Boolean);
    };
    rec.onerror = (e) => {
      const reason =
        e.error === 'no-speech'
          ? 'no-speech'
          : e.error === 'aborted'
            ? 'cancelled'
            : e.error === 'not-allowed' || e.error === 'service-not-allowed'
              ? 'denied'
              : e.error === 'network'
                ? 'network'
                : e.error === 'language-not-supported'
                  ? 'unavailable'
                  : 'error';
      const message =
        reason === 'denied'
          ? 'The microphone is blocked for this site. Allow it with the icon next to the address, then try again.'
          : reason === 'network'
            ? 'Speech recognition needs the internet in this browser, and it is offline.'
            : (e.message ?? 'Speech recognition stopped with an error.');
      failed = { ok: false, reason, message };
    };
    rec.onend = () => {
      clearTimeout(limit);
      active = null;
      if (transcripts.length) resolve({ ok: true, transcripts });
      else resolve(failed ?? { ok: false, reason: 'no-speech', message: 'Nothing was heard.' });
    };
    const limit = setTimeout(() => rec.stop(), LISTEN_LIMIT_MS);
    active = rec;
    o.onStatus?.('listening');
    try {
      rec.start();
    } catch (e) {
      clearTimeout(limit);
      active = null;
      resolve({ ok: false, reason: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  });
}
