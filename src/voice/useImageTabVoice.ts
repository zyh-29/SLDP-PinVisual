import { Platform } from 'react-native';

import { countRaised, describePattern, type Pattern } from '@/domain/pattern';
import { type LiveCapture, type LiveSource, supportsCamera, supportsScreenCapture } from '@/imaging/imageInput';
import { forNewPicture, type useConversionSettings } from '@/state/useConversionSettings';
import { useImageVoice } from './VoiceProvider';

/** What the Image tab can do and what it shows, for its voice commands. */
export interface ImageTab {
  live: Pick<LiveCapture, 'kind' | 'canFlip'> | null;
  hasPicture: boolean;
  /** The pins the user gets (edited or automatic). */
  shown: Pattern | null;
  /** The background tolerance worked out for this picture, used when the user hasn't set one. */
  autoTolerance: number | undefined;
  prefs: ReturnType<typeof useConversionSettings>;
  /** Null when started, else why not. */
  startLive: (source: LiveSource) => Promise<string | null>;
  /** Null when captured, else why not. */
  capturePhoto: () => Promise<string | null>;
  stopLive: () => void;
  flipCamera: () => Promise<void>;
  pick: () => Promise<void>;
  clearImage: () => void;
  /** Makes the pins the preview and opens the Display tab. */
  usePattern: () => void;
  /** Null when drawn, else why not. `quiet`: says nothing itself. */
  drawEquation: (text: string, quiet?: boolean) => string | null;
  /** Null when loaded, else why not. */
  loadPicture: (uri: string) => Promise<string | null>;
  waitForPins: (uri: string) => Promise<Pattern | null>;
  send: () => void;
}

const NO_PICTURE = "There's no picture yet. Say start camera, choose photo, or graph, then an equation.";

const SETTING_KEYS = {
  removeBackground: ['removeBackground', 'Remove Background'],
  smartCutout: ['cutoutOverride', 'Smart Cut-Out'],
  axes: ['linesOverride', 'Remove Axes and Grid'],
  labels: ['removeClutter', 'Ignore Labels and Text'],
  oneLine: ['thinLines', 'One-Pin Lines'],
  snap: ['snap', 'Snap to Shape'],
} as const;

/** Voice commands for the Image tab (see VoiceProvider): each answers with what happened. */
export function useImageTabVoice(tab: ImageTab) {
  const { live, shown, prefs } = tab;
  useImageVoice({
    drawEquation: (text) => tab.drawEquation(text, true),
    run: async (action) => {
      switch (action) {
        case 'camera':
          if (!supportsCamera) return 'This device has no camera the app can use.';
          if (live?.kind === 'camera') return 'The camera is already on.';
          return (await tab.startLive('camera')) ?? 'Camera on. Point it at something. It captures by itself once it locks on, or say capture.';
        case 'capture':
          if (live?.kind !== 'camera') return 'The camera is off. Say start camera first.';
          return (await tab.capturePhoto()) ?? 'Captured. Say what do the pins see, or use this pattern.';
        case 'stopCamera':
          if (live?.kind !== 'camera') return 'The camera is already off.';
          tab.stopLive();
          return 'Camera off. The last picture stays.';
        case 'flipCamera':
          if (live?.kind !== 'camera') return 'The camera is off. Say start camera first.';
          if (!live.canFlip) return 'This device has only one camera.';
          await tab.flipCamera();
          return '';
        case 'photo':
          void tab.pick();
          // A browser opens its file picker only straight after a tap or key press, which speaking isn't.
          return Platform.OS === 'web' ? 'Opening your photos. If nothing opens, press Choose Photo.' : 'Opening your photos.';
        case 'shareScreen':
          if (!supportsScreenCapture) return 'Screen sharing works in a desktop browser only.';
          void tab.startLive('screen');
          return 'Choose the screen or window to share. If nothing opens, press Share Screen.';
        case 'stopSharing':
          if (live?.kind !== 'screen') return 'Nothing is being shared.';
          tab.stopLive();
          return 'Stopped sharing. The last picture stays.';
        case 'clearImage':
          if (!tab.hasPicture) return 'There is no image to clear.';
          tab.clearImage();
          return '';
        case 'usePattern':
          if (!shown) return NO_PICTURE;
          tab.usePattern();
          return `Using these pins. ${countRaised(shown)} of ${shown.rows * shown.cols} raised. The Display tab shows them.`;
        case 'describeResult':
          return shown ? describePattern(shown) : NO_PICTURE;
      }
    },
    setSetting: (setting, on) => {
      const [key, label] = SETTING_KEYS[setting];
      prefs.set(key, on);
      return `${label} ${on ? 'on' : 'off'}.`;
    },
    adjust: (setting, up) => {
      if (setting === 'tolerance') {
        const now = prefs.settings.toleranceOverride ?? tab.autoTolerance ?? 40;
        const next = Math.max(8, Math.min(160, now + (up ? 10 : -10)));
        prefs.set('toleranceOverride', next);
        return `Tolerance ${next}. Higher treats more colours as background.`;
      }
      const next = Math.max(5, Math.min(95, prefs.settings.sensitivity + (up ? 10 : -10)));
      prefs.set('sensitivity', next);
      return `Sensitivity ${next}. Higher raises more pins.`;
    },
    loadPicture: tab.loadPicture,
    pictureSettings: () => forNewPicture(prefs.settings),
    settled: tab.waitForPins,
    result: () => shown ?? null,
    send: tab.send,
  });
}
