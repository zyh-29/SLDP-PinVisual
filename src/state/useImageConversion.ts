/**
 * The Image tab's conversion pipeline: from a graph drawn from an equation and the user's settings to the pins.
 * Smart crop (with tap to focus and graph windows), background removal, shape snapping and pin sampling. The
 * screen keeps the settings and the pin lock; this hook only derives.
 */
import { useMemo } from 'react';

import { GRID } from '@/config/hardware';
import type { Pattern } from '@/domain/pattern';
import { onlyInside, rectInside } from './conversionLogic';
import { type RasterImage, toGrayscale } from '@/imaging/convert';
import { DEFAULT_MIN_PIECE_RATIO, findForeground } from '@/imaging/foreground';
import { clip, fullRect, type Rect } from '@/imaging/geometry';
import type { GraphScale } from '@/imaging/graph';
import type { GraphRange } from '@/imaging/graphRange';
import { cellSizePx, inkFromGray, inkFromMask, patternFromSamples, renderCrop, sampleCrop, thickenThinLines, traceLinePins } from '@/imaging/pinSampling';
import { detectShape, fillHoles, renderShape } from '@/imaging/shapes';
import { type Focus, type GraphView, type SmartCropOptions, smartSubject } from '@/imaging/smartCrop';

export interface PickedImage {
  uri: string;
  /** Drawn from a typed equation (equation.ts): its scale is known exactly. */
  equation?: { text: string; scale: GraphScale };
  raster: RasterImage;
  rgb: Uint8ClampedArray;
}

/** Graph Range: units each side of the curve's key point, or the whole curve. */
export type { GraphRange } from '@/imaging/graphRange';

export interface ConversionSettings {
  removeBackground: boolean;
  removeClutter: boolean;
  /** null = automatic. */
  toleranceOverride: number | null;
  /** A pin is raised when at least this share (0..1) of it is subject. */
  pinFill: number;
  snap: boolean;
  /** null = automatic (smart crop). */
  manualCrop: Rect | null;
  /** A tapped point: the smart crop focuses on what's there. */
  focus: Focus | null;
  /** null = automatic: axes and gridlines are removed when the image looks like a graph. */
  linesOverride: boolean | null;
  graphRange: GraphRange;
  /** Graph curves as a line one pin wide (traceLinePins) instead of every pin they touch. */
  thinLines: boolean;
  /** The graph window moved by the user (graph units, right and up). */
  graphPan: { x: number; y: number };
}

export function useImageConversion(picked: PickedImage | null, s: ConversionSettings) {
  const { removeBackground, removeClutter, toleranceOverride, pinFill, snap, manualCrop, focus, linesOverride, graphRange, graphPan, thinLines } = s;

  const w = picked?.raster.width ?? 0;
  const h = picked?.raster.height ?? 0;
  const tolerance = toleranceOverride ?? 'auto';
  const minPieceRatio = removeClutter ? DEFAULT_MIN_PIECE_RATIO : 0;
  const removeLines = linesOverride ?? 'auto';

  // Smart crop: what part of the image should become pins (the curves, or a shape).
  const smartOptions = useMemo<SmartCropOptions>(() => ({ tolerance, minPieceRatio, removeLines }), [tolerance, minPieceRatio, removeLines]);
  const graphView = useMemo<GraphView>(
    () => ({
      range: graphRange,
      scale: picked?.equation?.scale ?? null,
      rows: GRID.rows,
      cols: GRID.cols,
      pinPitchRatio: GRID.pinPitchRatio,
      pan: graphPan,
    }),
    [graphRange, picked, graphPan],
  );
  const smart = useMemo(
    () => (picked ? smartSubject(picked.rgb, w, h, smartOptions, undefined, focus ?? undefined, graphView) : null),
    [picked, w, h, smartOptions, focus, graphView],
  );
  const graph = !manualCrop ? smart?.graph : undefined;
  // Inside the user's own box the same logic picks the subject, so stray marks caught by the box are ignored.
  const smartInCrop = useMemo(
    () => (picked && manualCrop ? smartSubject(picked.rgb, w, h, smartOptions, manualCrop) : null),
    [picked, manualCrop, w, h, smartOptions],
  );
  const chosen = manualCrop ? (smartInCrop?.kind === 'none' ? null : smartInCrop) : smart;
  const fullImage = useMemo(() => fullRect(w, h), [w, h]);
  const autoContext = smart?.context ?? fullImage;
  // The analysed area: around the chosen subject (its edge shows the background), else the user's box or the whole image.
  const region = chosen?.context ?? manualCrop ?? fullImage;
  // Graph curves mean axes and gridlines around them should go.
  const lines = linesOverride ?? (chosen?.kind === 'curves' || smart?.kind === 'curves' ? true : 'auto');
  // The subject's pixels when they are known exactly: the graph curves' own pixels.
  const knownSubject = removeBackground ? chosen?.mask : undefined;
  const fg = useMemo(
    () =>
      picked
        ? findForeground(picked.rgb, w, h, {
            tolerance,
            minPieceRatio,
            removeLines: lines,
            region,
            backgroundRegions: manualCrop ? [autoContext] : undefined,
            subjectMask: knownSubject,
            refine: true,
            subjectBox: chosen?.kind === 'shape' ? chosen.box : undefined,
          })
        : null,
    [picked, w, h, tolerance, minPieceRatio, lines, region, manualCrop, autoContext, knownSubject, chosen],
  );

  const autoBox = smart ? smart.box : (fg?.subject ?? fullImage);
  /** The crop box shown to the user (a graph window can reach past the picture when zoomed in; see graphWindow). */
  const crop = manualCrop ?? clip(autoBox, fullImage);
  /** What the pins use: the chosen subject's tight box (inside the user's box, if any), so empty margins don't waste pins. */
  const sampleBox = chosen?.box ?? (manualCrop ? (fg?.subject ?? manualCrop) : autoBox);
  // Graphs have arbitrary x and y scales, so they stretch to use every pin.
  const stretch = removeBackground && (!!fg?.linesRemoved || (chosen ?? smart)?.kind === 'curves');

  // Shapes (not graphs): close drawn outlines, then look for a clean triangle, square, circle...
  const shapesApply = removeBackground && !stretch;
  const filledMask = useMemo(() => (fg && shapesApply ? fillHoles(fg.mask, w, h, sampleBox) : null), [fg, shapesApply, w, h, sampleBox]);
  const shape = useMemo(() => (filledMask ? detectShape(filledMask, w, h, sampleBox) : null), [filledMask, w, h, sampleBox]);
  // Shapes are always shown filled: on a few pins a solid shape is the easiest to feel.
  const pinMask = filledMask ?? fg?.mask ?? null;

  // A graph window reaching past the plot (zoomed in): only the plot counts, so the pins off it stay down.
  const plotOnly = graph?.window && !rectInside(graph.window, graph.axes.plot) ? graph.axes.plot : null;
  const ink = useMemo(() => {
    if (!picked || !fg || !pinMask) return null;
    let out: Float32Array;
    // Remove Background off: darkness instead.
    if (!removeBackground) out = inkFromGray(toGrayscale(picked.raster));
    else {
      const cell = cellSizePx(sampleBox, GRID.rows, GRID.cols, GRID.pinPitchRatio, stretch);
      out = inkFromMask(thickenThinLines(pinMask, w, h, fg.strokeWidth, cell));
    }
    return plotOnly ? onlyInside(out, w, h, plotOnly) : out;
  }, [picked, fg, pinMask, removeBackground, sampleBox, stretch, w, h, plotOnly]);
  const samples = useMemo(
    () => (ink ? sampleCrop(ink, w, h, sampleBox, GRID.rows, GRID.cols, GRID.pinPitchRatio, stretch) : null),
    [ink, w, h, sampleBox, stretch],
  );
  // Graph curves: a line one pin wide, following the curve's centre.
  const curves = (chosen ?? smart)?.kind === 'curves';
  const traced = thinLines && removeBackground && curves && !!pinMask;
  const result = useMemo<Pattern | null>(() => {
    if (traced && pinMask) return traceLinePins(pinMask, w, h, sampleBox, GRID.rows, GRID.cols, GRID.pinPitchRatio, stretch, plotOnly ?? undefined);
    if (shape && snap && shapesApply) return renderShape(shape, GRID.rows, GRID.cols, GRID.pinPitchRatio, 'filled', pinFill);
    return samples ? patternFromSamples(samples, GRID.rows, GRID.cols, pinFill, false) : null;
  }, [traced, pinMask, w, h, sampleBox, stretch, plotOnly, shape, snap, shapesApply, pinFill, samples]);

  const cleaned = useMemo(
    () => (picked && fg ? renderCrop(picked.rgb, w, h, removeBackground ? pinMask : null, sampleBox) : null),
    [picked, fg, pinMask, w, h, removeBackground, sampleBox],
  );

  return {
    width: w,
    height: h,
    /** The subject is known exactly (curve pixels), so Tolerance doesn't apply. */
    subjectKnown: !!knownSubject,
    graph,
    fg,
    crop,
    stretch,
    shapesApply,
    /** The subject is graph curves. */
    curves,
    /** Graph curves are drawn one pin wide (Sensitivity doesn't apply). */
    traced,
    shape,
    /** The automatic pins. */
    result,
    /** "What the pins see": the crop, background removed (RGB pixels). */
    cleaned,
  };
}
