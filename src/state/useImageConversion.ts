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
import { holdGraphPins, nextGraphScale, onlyInside, rectInside, searchAreaAround } from './conversionLogic';
import type { SurfaceView } from '@/imaging/surface';
import { type RasterImage, toGrayscale } from '@/imaging/convert';
import { DEFAULT_MIN_PIECE_RATIO, estimateBackground, findForeground } from '@/imaging/foreground';
import { clip, fullRect, type Rect } from '@/imaging/geometry';
import { type GraphScale, labelBands, scaleFromGrid, scaleFromLabels } from '@/imaging/graph';
import type { LiveCapture } from '@/imaging/imageInput';
import { cellSizePx, inkFromGray, inkFromMask, patternFromSamples, renderCrop, sampleCrop, thickenThinLines, traceLinePins } from '@/imaging/pinSampling';
import { rgbToPngDataUri } from '@/imaging/previewPng';
import { segmentSubject, smartCutoutAvailable } from '@/imaging/segment';
import { detectShape, fillHoles, renderShape } from '@/imaging/shapes';
import { type Focus, type GraphView, isPhotoLike, keepPieceAt, type SmartCropOptions, smartSubject } from '@/imaging/smartCrop';

export interface PickedImage {
  uri: string;
  /**
   * Live camera looking at a flat surface: the picture is that surface flattened (surface.ts), and this maps it
   * to the camera view shown behind the crop box.
   */
  surface?: SurfaceView;
  /** Taken with the live camera (Capture): a real-world picture, whatever it shows. */
  fromCamera?: boolean;
  /** Drawn from a typed equation (equation.ts): its scale is known exactly, so no numbers are read. */
  equation?: { text: string; scale: GraphScale };
  /** Downscaled PNG on the device, for Smart Cut-Out (phones). */
  fileUri?: string;
  raster: RasterImage;
  rgb: Uint8ClampedArray;
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
  /** A tapped point (or, with the live camera, where its locked item is now): the smart crop focuses on what's there. */
  focus: Focus | null;
  /** null = automatic: axes and gridlines are removed when the image looks like a graph. */
  linesOverride: boolean | null;
  graphRange: GraphRange;
  /** Graph curves as a line one pin wide (traceLinePins) instead of every pin they touch. */
  thinLines: boolean;
  /** The graph window moved by the user (graph units, right and up). */
  graphPan: { x: number; y: number };
  /** Live camera: the locked item's width now (frame pixels, as tracked), so a graph's scale follows the zoom. */
  trackedWidth: number | null;
  /**
   * Live camera: where the locked item is now. The smart crop then only searches around it (the item and a wide
   * margin) instead of the whole picture: most of each frame's cost, so this keeps slow phones smooth.
   */
  trackedBox: Rect | null;
  /**
   * Live camera: `picked` is the frame kept when the lock settled (see watchCapture), not the newest one. Its pins
   * are used as they are (no averaging with other frames), and its numbers are read from its own pixels.
   */
  frozen: boolean;
}

/** Above this edge unevenness a photo's background is busy enough to switch Smart Cut-Out on by itself. */
const BUSY_BACKGROUND = 28;

export function useImageConversion(picked: PickedImage | null, live: LiveCapture | null, s: ConversionSettings) {
  const { removeBackground, removeClutter, toleranceOverride, pinFill, snap, cutoutOverride, manualCrop, focus, linesOverride, graphRange, graphPan, thinLines, trackedWidth, trackedBox, frozen } = s;
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
  // Not while live (Smart Cut-Out is off then): no point paying for it on every frame.
  const photoLike = useMemo(() => (picked && !live ? isPhotoLike(picked.rgb, w, h) : false), [picked, live, w, h]);
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
  // A flattened screen or page is a flat picture even though the camera made it look like a photo.
  const flatSurface = !!picked?.surface;
  // A camera picture (live, captured, or any real-world photo): backgrounds with several colours and shadows, and
  // wood grain or cloth patterns that are not graph curves.
  const camera = live?.kind === 'camera' || !!picked?.fromCamera || photoLike;
  const smartOptions = useMemo<SmartCropOptions>(
    () => ({ tolerance, minPieceRatio, removeLines, flatSurface, camera }),
    [tolerance, minPieceRatio, removeLines, flatSurface, camera],
  );
  const graphView = useMemo<GraphView>(
    () => ({
      range: graphRange === 'whole' ? 'whole' : Number(graphRange),
      scale: graphScale ?? picked?.equation?.scale ?? null,
      rows: GRID.rows,
      cols: GRID.cols,
      pinPitchRatio: GRID.pinPitchRatio,
      // The camera stays locked on one graph while it moves closer or further: keep its scale, resized.
      anyZoom: live?.kind === 'camera',
      targetWidth: live?.kind === 'camera' ? (trackedWidth ?? undefined) : undefined,
      // A shared screen being zoomed: the scale follows the grid frame by frame.
      followZoom: live?.kind === 'screen',
      pan: graphPan,
    }),
    [graphRange, graphScale, picked, live, trackedWidth, graphPan],
  );
  // Locked on an item: only around it (see searchAreaAround).
  const searchArea = useMemo(() => searchAreaAround(trackedBox, w, h, focus), [trackedBox, w, h, focus]);
  const smart = useMemo(
    () => (picked && !subjectMask ? smartSubject(picked.rgb, w, h, smartOptions, searchArea, focus ?? undefined, graphView) : null),
    [picked, subjectMask, w, h, smartOptions, focus, graphView, searchArea],
  );
  // Graphs: read the numbers on the axes (once per zoom level) to know where e.g. x = 5 is. Until then the whole
  // curve shows; if they can't be read, one major grid square counts as one unit.
  const graph = !manualCrop ? smart?.graph : undefined;
  const scaleKey = graph ? `${Math.round(graph.axes.majorX ?? 0)}x${Math.round(graph.axes.majorY ?? 0)}` : null;
  const readingNumbers = !!graph && graphRange !== 'whole' && !graph.scale;
  // A scale carried through a zoom (followZoom) is checked against the numbers once the zoom has settled.
  const checkingScale = !!graph?.scale?.followed && graphRange !== 'whole';
  useEffect(() => {
    if ((!readingNumbers && !checkingScale) || !graph || !scaleKey || !picked || scaleRequest.current === scaleKey) return;
    const { axes } = graph;
    // A flattened page (camera on a screen) is read from its own pixels: the bands are in its coordinates. So is a
    // kept frame: the video has moved on since.
    const source = picked.surface || frozen ? { pixels: { rgb: picked.rgb, width: w, height: h } } : live ? { video: live.video } : { uri: picked.uri };
    const read = () => {
      scaleRequest.current = scaleKey;
      readAxisNumbers(source, w, labelBands(axes))
        .then((readings) => scaleFromLabels(axes, readings))
        .catch(() => null)
        .then((found) => {
          // A newer request (another zoom level or picture) wins.
          if (scaleRequest.current !== scaleKey) return;
          // Checking a followed scale: only numbers that were read replace it. The grid's guess (one square, one
          // unit) would undo what following the zoom kept.
          if (checkingScale) {
            if (found) setGraphScale(found);
            return;
          }
          const s = found ?? scaleFromGrid(axes);
          // Remember how wide the locked graph was, so the scale can follow the camera's zoom from now on.
          setGraphScale(s && trackedWidth ? { ...s, atWidth: trackedWidth } : s);
        });
    };
    if (readingNumbers) {
      read();
      return;
    }
    // Still zooming: every frame is another zoom level. Read once the grid has held still for a moment.
    const t = setTimeout(read, 700);
    return () => clearTimeout(t);
  }, [readingNumbers, checkingScale, graph, scaleKey, picked, live, w, h, trackedWidth, frozen]);
  // Carry the scale on to the next frame (see nextGraphScale; React's "adjust state while rendering" pattern).
  const nextScale = nextGraphScale(graphScale, graph?.scale, trackedWidth, !!graphView.followZoom);
  if (nextScale) setGraphScale(nextScale);
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
            camera,
            // Shapes and objects: the GrabCut-style second opinion, told which object the smart crop picked.
            refine: true,
            subjectBox: chosen?.kind === 'shape' ? chosen.box : undefined,
          })
        : null,
    [picked, w, h, tolerance, minPieceRatio, lines, region, manualCrop, autoContext, knownSubject, camera, chosen],
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
  const pinMask = useMemo(
    // Shapes are always shown filled: on 40 pins a solid shape is the easiest to feel.
    () => filledMask ?? fg?.mask ?? null,
    [filledMask, fg],
  );

  // A graph window reaching past the plot (zoomed in): only the plot counts, so the pins off it stay down
  // instead of showing the graphing tool's buttons or side panel.
  const plotOnly = graph?.window && !rectInside(graph.window, graph.axes.plot) ? graph.axes.plot : null;
  const ink = useMemo(() => {
    if (!picked || !fg || !pinMask) return null;
    let out: Float32Array;
    // Remove Background off: darkness instead (worked out only then; most pictures never need it).
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
  const frameResult = useMemo<Pattern | null>(() => {
    if (traced && pinMask) return traceLinePins(pinMask, w, h, sampleBox, GRID.rows, GRID.cols, GRID.pinPitchRatio, stretch, plotOnly ?? undefined);
    if (shape && snap && shapesApply) return renderShape(shape, GRID.rows, GRID.cols, GRID.pinPitchRatio, 'filled', pinFill);
    return samples ? patternFromSamples(samples, GRID.rows, GRID.cols, pinFill, false) : null;
  }, [traced, pinMask, w, h, sampleBox, stretch, plotOnly, shape, snap, shapesApply, pinFill, samples]);

  // Live camera: noise and a moving hand change a few pins on every frame, so each pin is averaged over the last
  // frames and only flips once it has clearly changed (cameraFrame.ts). Folded in once per new frame result
  // (React's "adjust state while rendering" pattern, so the pins never lag a render behind). A kept frame is
  // used as it is: it was chosen to agree with the averaged pins, and settings changes must show at once.
  const steadyOn = live?.kind === 'camera' && !frozen;
  const [steady, setSteady] = useState<{ from: Pattern | null; state: SteadyPins | null }>({ from: null, state: null });
  // Live share or camera, zoomed to another level: until its numbers are read the scale is unknown and the whole
  // curve would fill the board for a moment. The last graph window's pins are held instead, so the curve keeps its
  // size on the board through the zoom.
  const [heldGraph, setHeldGraph] = useState<Pattern | null>(null);
  const hold = holdGraphPins(heldGraph, frameResult, {
    live: !!live,
    graph: !!graph,
    windowed: !!graph?.window,
    readingNumbers,
    wholeCurve: graphRange === 'whole',
  });
  if (hold.held !== undefined) setHeldGraph(hold.held);
  const shown = hold.shown;
  let result = shown;
  if (steadyOn && shown) {
    if (steady.from !== shown) {
      const state = steadyPins(steady.state, shown);
      setSteady({ from: shown, state });
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
    setHeldGraph(null);
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
    /** The item the smart crop picked (a graph's plot, a shape), for the camera to lock onto. */
    target: !manualCrop && smart && smart.kind !== 'none' ? smart.target : null,
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
    /** This frame's own pins, before averaging with earlier frames (live camera). */
    framePins: shown,
    /** "What the pins see": the crop, background removed. */
    cleanedUri,
    resetGraph,
  };
}
