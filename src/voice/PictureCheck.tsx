import { useEffect, useState } from 'react';

import type { Pattern } from '@/domain/pattern';
import { toRgb } from '@/imaging/foreground';
import { loadImagePixels } from '@/imaging/loadImage';
import type { ConversionPrefs } from '@/state/useConversionSettings';
import { type PickedImage, useImageConversion } from '@/state/useImageConversion';

/**
 * Works out, off screen, the pins a search result would make: the Image tab's own conversion with its settings, so
 * the answer is the same as if it were shown. Voice checks several results at once this way and shows the first
 * useful one, instead of loading them on the Image tab one after another. Draws nothing.
 */
export function PictureCheck({ uri, settings, onDone }: { uri: string; settings: ConversionPrefs; onDone: (uri: string, pins: Pattern | null) => void }) {
  const [picked, setPicked] = useState<PickedImage | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    loadImagePixels(uri, 0, 0).then(
      (raster) => live && setPicked({ uri, fileUri: raster.fileUri, raster, rgb: toRgb(raster) }),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [uri]);
  const c = useImageConversion(picked, null, {
    removeBackground: settings.removeBackground,
    removeClutter: settings.removeClutter,
    toleranceOverride: settings.toleranceOverride,
    pinFill: (100 - settings.sensitivity) / 100,
    snap: settings.snap,
    cutoutOverride: settings.cutoutOverride,
    manualCrop: null,
    focus: null,
    linesOverride: settings.linesOverride,
    graphRange: settings.graphRange,
    graphPan: settings.graphPan,
    thinLines: settings.thinLines,
    trackedWidth: null,
    trackedBox: null,
    frozen: false,
  });
  const done = failed || (!!picked && !c.cuttingOut && !c.readingNumbers);
  const pins = failed ? null : c.result;
  useEffect(() => {
    if (done) onDone(uri, pins ?? null);
  }, [done, pins, uri, onDone]);
  return null;
}
