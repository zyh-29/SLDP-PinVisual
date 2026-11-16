import { countRaised, describePattern, type Pattern } from '@/domain/pattern';
import type { useConversionSettings } from '@/state/useConversionSettings';
import { useImageVoice } from './VoiceProvider';

/** What the Image tab can do and what it shows, for its voice commands. */
export interface ImageTab {
  hasPicture: boolean;
  /** The pins the user gets (edited or automatic). */
  shown: Pattern | null;
  /** The background tolerance worked out for this graph, used when the user hasn't set one. */
  autoTolerance: number | undefined;
  prefs: ReturnType<typeof useConversionSettings>;
  clearImage: () => void;
  /** Makes the pins the preview and opens the Display tab. */
  usePattern: () => void;
  /** Null when drawn, else why not. `quiet`: says nothing itself. */
  drawEquation: (text: string, quiet?: boolean) => string | null;
  send: () => void;
}

const NO_PICTURE = "There's no graph yet. Say graph, then an equation.";

const SETTING_KEYS = {
  removeBackground: ['removeBackground', 'Remove Background'],
  axes: ['linesOverride', 'Remove Axes and Grid'],
  labels: ['removeClutter', 'Ignore Labels and Text'],
  oneLine: ['thinLines', 'One-Pin Lines'],
  snap: ['snap', 'Snap to Shape'],
} as const;

/** Voice commands for the Image tab (see VoiceProvider): each answers with what happened. */
export function useImageTabVoice(tab: ImageTab) {
  const { shown, prefs } = tab;
  useImageVoice({
    drawEquation: (text) => tab.drawEquation(text, true),
    run: async (action) => {
      switch (action) {
        case 'clearImage':
          if (!tab.hasPicture) return 'There is no graph to clear.';
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
    result: () => shown ?? null,
    send: tab.send,
  });
}
