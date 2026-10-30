import type { ExpoSpeechRecognitionModuleType } from 'expo-speech-recognition/build/ExpoSpeechRecognitionModule.types';
import { Platform } from 'react-native';

/**
 * Hearing one command (iPhone and Android): the phone's own speech recogniser, through expo-speech-recognition.
 * On the device wherever the phone can (most recent iPhones and Androids with the language downloaded); on its
 * maker's servers only when the user allowed that in Settings. The browser version is recognizer.web.ts.
 */
export type ListenResult =
  | { ok: true; transcripts: string[] }
  | { ok: false; reason: 'no-speech' | 'denied' | 'unavailable' | 'needs-online' | 'cancelled' | 'network' | 'error'; message: string };

export interface RecognitionSupport {
  /** Voice commands can work here at all. */
  available: boolean;
  /** Recognition can stay on this device. False: only on the recogniser maker's servers. */
  onDevice: boolean;
}

/** The module is native code: missing in Expo Go and in builds made before it was added. */
function speechModule(): ExpoSpeechRecognitionModuleType | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded on first use, so a build without it still runs
    return (require('expo-speech-recognition') as { ExpoSpeechRecognitionModule: ExpoSpeechRecognitionModuleType }).ExpoSpeechRecognitionModule;
  } catch {
    return null;
  }
}

export async function recognitionSupport(): Promise<RecognitionSupport> {
  const m = speechModule();
  if (!m) return { available: false, onDevice: false };
  try {
    return { available: m.isRecognitionAvailable(), onDevice: m.supportsOnDeviceRecognition() };
  } catch {
    return { available: false, onDevice: false };
  }
}

let active: ExpoSpeechRecognitionModuleType | null = null;

/** Stops listening; the command heard so far (if any) is still used. */
export function finishListening() {
  active?.stop();
}

/** Stops listening and drops what was heard. */
export function cancelListening() {
  active?.abort();
}

const LISTEN_LIMIT_MS = 15_000;

export async function listen(o: {
  allowOnline: boolean;
  hints: string[];
  lang?: string;
  /** Browser only: the language is downloading first, then listening starts. */
  onStatus?: (s: 'downloading' | 'listening') => void;
}): Promise<ListenResult> {
  const m = speechModule();
  if (!m) return { ok: false, reason: 'unavailable', message: 'Voice commands need the full PinVisual app, not Expo Go.' };
  const support = await recognitionSupport();
  if (!support.available) return { ok: false, reason: 'unavailable', message: 'Speech recognition is not available on this phone.' };
  const onDevice = support.onDevice;
  if (!onDevice && !o.allowOnline)
    return {
      ok: false,
      reason: 'needs-online',
      message: 'This phone can only recognise speech online. To allow it, turn on Online Speech Recognition in the Device tab.',
    };
  // On-device recognition needs only the microphone on iPhone; server recognition needs speech permission too.
  const perm = onDevice && Platform.OS === 'ios' ? await m.requestMicrophonePermissionsAsync() : await m.requestPermissionsAsync();
  if (!perm.granted)
    return { ok: false, reason: 'denied', message: 'PinVisual is not allowed to use the microphone. Allow it in the phone’s Settings app.' };

  return new Promise<ListenResult>((resolve) => {
    let transcripts: string[] = [];
    let failed: ListenResult | null = null;
    const subs = [
      m.addListener('result', (e) => {
        transcripts = e.results.map((r) => r.transcript).filter(Boolean);
      }),
      m.addListener('error', (e) => {
        const reason =
          e.error === 'no-speech' || e.error === 'speech-timeout'
            ? 'no-speech'
            : e.error === 'aborted'
              ? 'cancelled'
              : e.error === 'not-allowed'
                ? 'denied'
                : e.error === 'network'
                  ? 'network'
                  : e.error === 'language-not-supported' || e.error === 'service-not-allowed'
                    ? 'unavailable'
                    : 'error';
        failed = { ok: false, reason, message: e.message };
      }),
      m.addListener('end', () => {
        clearTimeout(limit);
        subs.forEach((s) => s.remove());
        active = null;
        if (transcripts.length) resolve({ ok: true, transcripts });
        else resolve(failed ?? { ok: false, reason: 'no-speech', message: 'Nothing was heard.' });
      }),
    ];
    // A command is a few seconds long; don't leave the microphone on if the recogniser never stops by itself.
    const limit = setTimeout(() => m.stop(), LISTEN_LIMIT_MS);
    active = m;
    m.start({
      lang: o.lang ?? 'en-US',
      interimResults: false,
      continuous: false,
      maxAlternatives: 5,
      requiresOnDeviceRecognition: onDevice,
      contextualStrings: o.hints,
      iosTaskHint: 'confirmation',
    });
  });
}
