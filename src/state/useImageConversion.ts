/**
 * The Image tab's conversion pipeline: from a picture (or a live screen share) and the user's settings to the
 * pins. Smart Cut-Out, smart crop (with tap to focus and graph windows), background removal, shape snapping and
 * pin sampling. The screen keeps the settings and the pin lock; this hook only derives.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

import { GRID } from '@/config/hardware';
import type { Pattern } from '@/domain/pattern';
import { readAxisNumbers } from '@/imaging/axisNumbers';
import { type SteadyPins, steadyPins } from '@/imaging/cameraFrame';
import type { RasterImage } from '@/imaging/convert';
import { DEFAULT_MIN_PIECE_RATIO, estimateBackground, findForeground } from '@/imaging/foreground';
import { fullRect, type Point, type Rect } from '@/imaging/geometry';
import { type GraphScale, labelBands, scaleFromGrid, scaleFromLabels } from '@/imaging/graph';
import type { LiveCapture } from '@/imaging/imageInput';
import { cellSizePx, inkFromGray, inkFromMask, patternFromSamples, renderCrop, sampleCrop, thickenThinLines } from '@/imaging/pinSampling';
import { rgbToPngDataUri } from '@/imaging/previewPng';
import { segmentSubject, smartCutoutAvailable } from '@/imaging/segment';
import { detectShape, fillHoles, renderShape } from '@/imaging/shapes';
import { type GraphView, isPhotoLike, keepPieceAt, type SmartCropOptions, smartSubject } from '@/imaging/smartCrop';

export interface PickedImage {
  uri: string;
  /** Downscaled PNG on the device, for Smart Cut-Out (phones). */
  fileUri?: string;
  raster: RasterImage;
  rgb: Uint8ClampedArray;
  gray: Float32Array;
}

/** Graph Range: units each side of the curve's key point, or the whole curve. */
export type GraphRange = '2' | '5' | '10' | 'whole';

export interface ConversionSettings {
  removeBackground: boolean;
  removeClutter: boolean;
  /** null = automatic. */
  toleranceOverride: number | null;
  /** A pin is raised when at least this share (0..1) of it is subject. */
  pinFill: number;
  snap: boolean;
  /** null = automatic: Smart Cut-Out runs when the background is busy. */
  cutoutOverride: boolean | null;
  /** null = automatic (smart crop). */
  manualCrop: Rect | null;
  /** A tapped point: the smart crop focuses on what's there. */
  focus: Point | null;
  /** null = automatic: axes and gridlines are removed when the image looks like a graph. */
  linesOverride: boolean | null;
  graphRange: GraphRange;
}

/** Above this edge unevenness a photo's background is busy enough to switch Smart Cut-Out on by itself. */
const BUSY_BACKGROUND = 28;

export function useImageConversion(picked: PickedImage | null, live: LiveCapture | null, s: ConversionSettings) {
  const { removeBackground, removeClutter, toleranceOverride, pinFill, snap, cutoutOverride, manualCrop, focus, linesOverride, graphRange } = s;
  const [cutout, setCutout] = useState<{ for: PickedImage; mask: Float32Array | null; error?: string } | null>(null);
  /** Graphs: pixels per unit, read from the axis numbers (or the grid). Kept across live frames while the zoom is unchanged. */
  const [graphScale, setGraphScale] = useState<GraphScale | null>(null);
  /** The grid (spacing) whose numbers are being, or were, read: each zoom level is read once. */
  const scaleRequest = useRef<string | null>(null);

  const w = picked?.raster.width ?? 0;
  const h = picked?.raster.height ?? 0;
  const tolerance = toleranceOverride ?? 'auto';
  const minPieceRatio = removeClutter ? DEFAULT_MIN_PIECE_RATIO : 0;
  const removeLines = linesOverride ?? 'auto';

  // Smart Cut-Out (AI subject segmentation, on-device) only for photos with a busy background. Screenshots,
  // graphs and drawings (lots of perfectly flat colour) never get it automatically: the AI keeps one solid
  // object and would throw away thin curves.
  const photoLike = useMemo(() => (picked ? isPhotoLike(picked.rgb, w, h) : false), [picked, w, h]);
  const busyPhoto = useMemo(
    () => (picked && photoLike ? estimateBackground(picked.rgb, w, h).noise > BUSY_BACKGROUND : false),
    [picked, photoLike, w, h],
  );
  const cutoutOn = removeBackground && smartCutoutAvailable && !live && (cutoutOverride ?? busyPhoto);
  const cuttingOut = cutoutOn && cutout?.for !== picked;
  const cutoutMask = cutoutOn && cutout?.for === picked ? (cutout.mask ?? undefined) : undefined;
  // A tap with Smart Cut-Out on: of the subjects it found (two people, a cat and a dog), keep the tapped one.
  const subjectMask = useMemo(
    () => (cutoutMask && focus ? keepPieceAt(cutoutMask, w, h, focus) : cutoutMask),
    [cutoutMask, focus, w, h],
  );
  useEffect(() => {
    if (!cutoutOn || !picked || cutout?.for === picked) return;
    let cancelled = false;
    segmentSubject({ rgb: picked.rgb, width: picked.raster.width, height: picked.raster.height, fileUri: picked.fileUri })
      .then((mask) => !cancelled && setCutout({ for: picked, mask }))
      .catch((e) => !cancelled && setCutout({ for: picked, mask: null, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      cancelled = true;
    };
  }, [cutoutOn, picked, cutout]);

  // Smart crop: what part of the image should become pins (coloured curves, a shape, the object on a card).
  const smartOptions = useMemo<SmartCropOptions>(
    () => ({ tolerance, minPieceRatio, removeLines }),
    [tolerance, minPieceRatio, removeLines],
  );
  const graphView = useMemo<GraphView>(
    () => ({
      range: graphRange === 'whole' ? 'whole' : Number(graphRange),
      scale: graphScale,
      rows: GRID.rows,
      cols: GRID.cols,
      pinPitchRatio: GRID.pinPitchRatio,
    }),
    [graphRange, graphScale],
  );
  const smart = useMemo(
    () => (picked && !subjectMask ? smartSubject(picked.rgb, w, h, smartOptions, undefined, focus ?? undefined, graphView) : null),
    [picked, subjectMask, w, h, smartOptions, focus, graphView],
  );
  // Graphs: read the numbers on the axes (once per zoom level) to know where e.g. x = 5 is. Until then the whole
  // curve shows; if they can't be read, one major grid square counts as one unit.
  const graph = !manualCrop ? smart?.graph : undefined;
  const scaleKey = graph ? `${Math.round(graph.axes.majorX ?? 0)}x${Math.round(graph.axes.majorY ?? 0)}` : null;
  const readingNumbers = !!graph && graphRange !== 'whole' && !graph.scale;
  useEffect(() => {
    if (!readingNumbers || !graph || !scaleKey || !picked || scaleRequest.current === scaleKey) return;
    scaleRequest.current = scaleKey;
    const { axes } = graph;
    readAxisNumbers(live ? { video: live.video } : { uri: picked.uri }, w, labelBands(axes))
      .then((readings) => scaleFromLabels(axes, readings))
      .catch(() => null)
      .then((found) => {
        // A newer request (another zoom level or picture) wins.
        if (scaleRequest.current === scaleKey) setGraphScale(found ?? scaleFromGrid(axes));
      });
  }, [readingNumbers, graph, scaleKey, picked, live, w]);
  // Inside the user's own box the same logic picks the subject, so stray UI caught by the box is ignored.
  const smartInCrop = useMemo(
    () => (picked && manualCrop && !subjectMask ? smartSubject(picked.rgb, w, h, smartOptions, manualCrop) : null),
    [picked, manualCrop, subjectMask, w, h, smartOptions],
  );
  const chosen = manualCrop ? (smartInCrop?.kind === 'none' ? null : smartInCrop) : smart;
  const fullImage = useMemo(() => fullRect(w, h), [w, h]);
  const autoContext = smart?.context ?? fullImage;
  // The analysed area: around the chosen subject (its edge shows the background), else the user's box or the whole image.
  const region = chosen?.context ?? manualCrop ?? fullImage;
  // Graph curves mean axes and gridlines around them should go.
  const lines = linesOverride ?? (chosen?.kind === 'curves' || smart?.kind === 'curves' ? true : 'auto');
  // The subject's pixels when they are known exactly: the AI cut-out, or the graph curves' own pixels.
  const knownSubject = subjectMask ?? (removeBackground ? chosen?.mask : undefined);
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
          })
        : null,
    [picked, w, h, tolerance, minPieceRatio, lines, region, manualCrop, autoContext, knownSubject],
  );
  const autoBox = smart ? smart.box : (fg?.subject ?? fullImage);
  /** The crop box shown to the user. */
  const crop = manualCrop ?? autoBox;
  /** What the pins use: the chosen subject's tight box (inside the user's box, if any), so empty margins don't waste pins. */
  const sampleBox = chosen?.box ?? (manualCrop ? (fg?.subject ?? manualCrop) : autoBox);
  // Graphs have arbitrary x and y scales, so they stretch to use every pin.
  const stretch = removeBackground && (!!fg?.linesRemoved || (chosen ?? smart)?.kind === 'curves');

  // Shapes (not graphs): close drawn outlines, then look for a clean triangle, square, circle...
  const shapesApply = removeBackground && !stretch;
  const filledMask = useMemo(() => (fg && shapesApply ? fillHoles(fg.mask, w, h, sampleBox) : null), [fg, shapesApply, w, h, sampleBox]);
  const shape = useMemo(() => (filledMask ? detectShape(filledMask, w, h, sampleBox) : null), [filledMask, w, h, sampleBox]);
  const pinMask = useMemo(
    // Shapes are always shown filled: on 40 pins a solid shape is the easiest to feel.
    () => filledMask ?? fg?.mask ?? null,
    [filledMask, fg],
  );

  const ink = useMemo(() => {
    if (!picked || !fg || !pinMask) return null;
    if (!removeBackground) return inkFromGray(picked.gray);
    const cell = cellSizePx(sampleBox, GRID.rows, GRID.cols, GRID.pinPitchRatio, stretch);
    return inkFromMask(thickenThinLines(pinMask, w, h, fg.strokeWidth, cell));
  }, [picked, fg, pinMask, removeBackground, sampleBox, stretch, w, h]);
  const samples = useMemo(
    () => (ink ? sampleCrop(ink, w, h, sampleBox, GRID.rows, GRID.cols, GRID.pinPitchRatio, stretch) : null),
    [ink, w, h, sampleBox, stretch],
  );
  const frameResult = useMemo<Pattern | null>(() => {
    if (shape && snap && shapesApply) return renderShape(shape, GRID.rows, GRID.cols, GRID.pinPitchRatio, 'filled', pinFill);
    return samples ? patternFromSamples(samples, GRID.rows, GRID.cols, pinFill, false) : null;
  }, [shape, snap, shapesApply, pinFill, samples]);

  // Live camera: noise and a moving hand change a few pins on every frame, so each pin is averaged over the last
  // frames and only flips once it has clearly changed (cameraFrame.ts). Folded in once per new frame result
  // (React's "adjust state while rendering" pattern, so the pins never lag a render behind).
  const steadyOn = live?.kind === 'camera';
  const [steady, setSteady] = useState<{ from: Pattern | null; state: SteadyPins | null }>({ from: null, state: null });
  let result = frameResult;
  if (steadyOn && frameResult) {
    if (steady.from !== frameResult) {
      const state = steadyPins(steady.state, frameResult);
      setSteady({ from: frameResult, state });
      result = state.pattern;
    } else if (steady.state) result = steady.state.pattern;
  } else if (!steadyOn && steady.state) setSteady({ from: null, state: null });

  const cleanedUri = useMemo(
    () => (picked && fg ? rgbToPngDataUri(renderCrop(picked.rgb, w, h, removeBackground ? pinMask : null, sampleBox)) : null),
    [picked, fg, pinMask, w, h, removeBackground, sampleBox],
  );

  /** A new picture or share: the graph's scale must be read again. */
  const resetGraph = () => {
    setGraphScale(null);
    scaleRequest.current = null;
  };

  return {
    width: w,
    height: h,
    busyPhoto,
    cutoutOn,
    cuttingOut,
    cutoutError: cutoutOn ? cutout?.error : undefined,
    /** The subject is known exactly (cut-out or curve pixels), so Tolerance doesn't apply. */
    subjectKnown: !!knownSubject,
    graph,
    readingNumbers,
    fg,
    crop,
    stretch,
    shapesApply,
    shape,
    /** The automatic pins. */
    result,
    /** "What the pins see": the crop, background removed. */
    cleanedUri,
    resetGraph,
  };
}
