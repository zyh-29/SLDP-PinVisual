import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, View } from 'react-native';

import { GRID } from '@/config/hardware';
import { cellsToString, type Pattern, togglePin } from '@/domain/pattern';
import { viewMoved, viewSketch } from '@/imaging/cameraFrame';
import { toRgb } from '@/imaging/foreground';
import { fullRect, type Point, type Rect } from '@/imaging/geometry';
import {
  type ImageSource,
  type LiveCapture,
  type LiveSource,
  startLiveCapture,
  supportsCamera,
  supportsFileDrop,
  supportsScreenCapture,
  useImageDrop,
} from '@/imaging/imageInput';
import { parseEquation, renderEquation } from '@/imaging/equation';
import { loadImagePixels } from '@/imaging/loadImage';
import { renderCrop } from '@/imaging/pinSampling';
import { rgbToPngDataUri } from '@/imaging/previewPng';
import { usePattern } from '@/state/PatternProvider';
import type { Focus } from '@/imaging/smartCrop';
import { mapRect, type SurfaceView } from '@/imaging/surface';
import { type CaptureWatch, carryRect, watchCapture } from '@/state/conversionLogic';
import { useCameraLock, useLockTarget } from '@/state/useCameraLock';
import { useBoardActions } from '@/state/useBoardActions';
import { useLiveSend } from '@/state/useLiveSend';
import { NO_PAN, useConversionSettings } from '@/state/useConversionSettings';
import { type PickedImage, useImageConversion } from '@/state/useImageConversion';
import { Button, Columns, Screen, Section, StatusBanner } from '@/ui/components';
import { ConversionSettings } from '@/ui/ConversionSettings';
import { CropEditor } from '@/ui/CropEditor';
import { CAMERA_HINT, ImageSourcePicker, SCREEN_HINT } from '@/ui/ImageSourcePicker';
import { DropOverlay, LiveBadge } from '@/ui/ImageOverlays';
import { ImageResult } from '@/ui/ImageResult';
import { LiveVideo } from '@/ui/LiveVideo';
import { SavePatternSheet } from '@/ui/SavePatternSheet';
import { radius, space, useTheme } from '@/ui/theme';


/**
 * A live frame kept as a still picture: it gets an image of its own for the crop view, and a camera frame stays
 * a camera picture (the same background handling, so the pins don't change when the camera stops).
 */
const asStill = (p: PickedImage | null, fromCamera: boolean): PickedImage | null =>
  p && !p.uri
    ? {
        ...p,
        fromCamera: p.fromCamera || fromCamera,
        uri: rgbToPngDataUri(renderCrop(p.rgb, p.raster.width, p.raster.height, null, fullRect(p.raster.width, p.raster.height))),
      }
    : p;

/**
 * Live camera: the frame kept once the lock on an item settled, with what the lock knew then (where the item was,
 * its tracked width, the crop shown). The pins come from it, and hold still, until another item is tapped.
 */
interface LockCapture {
  frame: PickedImage;
  focus: Focus | null;
  box: Rect | null;
  width: number | null;
  crop: Rect;
  /** Kept from a busy scene, with no item locked (see SCENE_FRAMES): the view it showed, to notice when it changes. */
  sketch?: Float32Array;
}

/**
 * Live camera on a busy real-world scene (a street, a landscape), locked onto no item for this many frames (about
 * a second and a half): a frame is kept anyway, and judged as a photo (the car cut out, the skyline found). A page
 * or a screen is locked within two or three frames, so it never gets here.
 */
const SCENE_FRAMES = 8;

/** A rectangle of the analysed picture in the camera view's coordinates (they differ on a flattened page). */
const toView = (r: Rect, surface: SurfaceView | undefined) =>
  surface ? mapRect(r, surface.toFrame, { width: surface.frameWidth, height: surface.frameHeight }) : r;

export default function ImageScreen() {
  const t = useTheme();
  const { setPattern } = usePattern();
  const [picked, setPicked] = useState<PickedImage | null>(null);
  const prefs = useConversionSettings();
  const { removeBackground, removeClutter, toleranceOverride, sensitivity, snap, cutoutOverride, linesOverride, graphRange, graphPan, thinLines } =
    prefs.settings;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** null = automatic (smart crop). */
  const [manualCrop, setManualCrop] = useState<Rect | null>(null);
  /** A point the user tapped on the picture: the smart crop focuses on what's there (e.g. one picture in a grid). */
  const [focus, setFocus] = useState<Focus | null>(null);
  const [dragging, setDragging] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  /** The user's pin edits and lock state, tied to the picture they were made on (see the pin lock below). */
  const [editState, setEditState] = useState<{ picked: PickedImage; auto: string; pattern: Pattern | null; unlocked: boolean } | null>(
    null,
  );
  /** null = automatic: axes and gridlines are removed when the image looks like a graph. */
  const [live, setLive] = useState<LiveCapture | null>(null);
  /** Live camera focus: 0 sharp, 1 refocusing, 2 can't get sharp. */
  const [focusTrouble, setFocusTrouble] = useState<0 | 1 | 2>(0);
  const cameraTrouble = live?.kind === 'camera' ? focusTrouble : 0;
  /** Live camera: the picture is essentially black (analysis paused). */
  const [tooDark, setTooDark] = useState(false);
  const cameraDark = live?.kind === 'camera' && tooDark;
  /** Graphs: how much of the graph the pins show (around the middle of the graph), at its true proportions. */
  /** The graph window moved with the arrows (units, right and up); back to the curve for each new graph. */

  // Stop screen sharing when the session is replaced or the screen goes away.
  useEffect(() => () => live?.stop(), [live]);

  // Live camera: stay locked onto the item found (or tapped) while the phone moves.
  const lock = useCameraLock(live);
  const [capture, setCapture] = useState<LockCapture | null>(null);
  /** The frames looked at so far for a capture (see watchCapture), and the last one looked at. */
  const [watch, setWatch] = useState<{ for: PickedImage | null; w: CaptureWatch<LockCapture> | null }>({ for: null, w: null });
  /** A hand-drawn crop box is fixed in the camera view: it follows the live picture, not a kept frame. */
  const kept = live?.kind === 'camera' && !manualCrop ? capture : null;
  /** Live frames in a row on a busy scene with no item locked (see SCENE_FRAMES), counted once per frame. */
  const [scene, setScene] = useState<{ for: PickedImage | null; frames: number }>({ for: null, frames: 0 });
  /** The last live frame checked against a kept scene's view. */
  const [viewChecked, setViewChecked] = useState<PickedImage | null>(null);
  /** The picture the pins are made from: the kept frame, else the newest one. */
  const analysed = kept?.frame ?? picked;
  /** For callbacks made once per live session (onEnd, leaving the tab). */
  const keptRef = useRef(kept);
  const liveRef = useRef(live);
  const dropCapture = () => {
    setCapture(null);
    setWatch({ for: null, w: null });
    setScene({ for: null, frames: 0 });
  };
  /** When the frame being analysed arrived: its cost (arrival to on screen) paces the live capture. */
  const frameStart = useRef(0);
  /** The camera is delivering a flattened surface (see onFrame). */
  const onSurface = useRef(false);
  const c = useImageConversion(analysed, live, {
    removeBackground,
    removeClutter,
    toleranceOverride,
    pinFill: (100 - sensitivity) / 100,
    snap,
    cutoutOverride,
    manualCrop,
    focus: kept ? kept.focus : focus,
    linesOverride,
    graphRange,
    graphPan,
    thinLines,
    trackedWidth: kept ? kept.width : lock.width,
    trackedBox: kept ? kept.box : lock.box,
    frozen: !!kept,
  });
  const { width: w, height: h, fg, result } = c;
  /** Live camera on a flat surface: the analysed picture is the flattened page (see onFrame). */
  const surface = live?.kind === 'camera' ? picked?.surface : undefined;
  // A kept frame's item is no news to the lock: it only follows the item on the live picture from then on.
  useLockTarget(lock, analysed, kept ? null : c.target);
  // A busy scene with nothing locked: count the frames (once per new frame).
  if (live?.kind === 'camera' && !kept && picked && scene.for !== picked)
    setScene({ for: picked, frames: c.busyScene && !lock.locked && !manualCrop ? scene.frames + 1 : 0 });
  const sceneMode = live?.kind === 'camera' && !kept && !manualCrop && !lock.locked && c.busyScene && scene.frames >= SCENE_FRAMES;
  // Keep a frame once the lock has settled, or the scene has (React's "adjust state while rendering" pattern: once
  // per new frame).
  if (live?.kind === 'camera' && !kept && picked && watch.for !== picked && (lock.locked || sceneMode || watch.w)) {
    const r = watchCapture(watch.w, {
      ready: (lock.locked || sceneMode) && !manualCrop && !c.readingNumbers && !c.cuttingOut,
      sharp: cameraTrouble === 0 && !cameraDark,
      steady: c.result,
      raw: c.framePins,
      item: {
        frame: picked,
        focus,
        box: lock.box,
        width: lock.width,
        crop: c.crop,
        sketch: sceneMode ? viewSketch(picked.rgb, picked.raster.width, picked.raster.height) : undefined,
      },
    });
    setWatch({ for: picked, w: r.watch });
    if (r.capture) setCapture(r.capture);
  }
  // A kept scene has no item to follow: once the camera turns to something else, it lets go and looks again.
  if (kept?.sketch && picked && picked !== kept.frame && viewChecked !== picked) {
    setViewChecked(picked);
    if (viewMoved(kept.sketch, viewSketch(picked.rgb, picked.raster.width, picked.raster.height))) dropCapture();
  }
  useEffect(() => {
    if (capture)
      AccessibilityInfo.announceForAccessibility(
        capture.sketch
          ? 'Captured. The pins hold still until the camera turns to something else.'
          : 'Captured. The pins hold still on this item until you tap another one.',
      );
  }, [capture]);
  /**
   * The crop box on the live view. With a kept frame: where its crop is now, carried along with the locked item as
   * the camera moves (or where it was, once the item is out of sight).
   */
  // The kept frame's own crop as it is now (c is worked out on that frame): once its cut-out or skyline arrives, the
  // box shows what the pins really use, not where it was when the frame was kept.
  const viewCrop = kept
    ? kept.box && lock.box
      ? toView(carryRect(c.crop, kept.box, lock.box), surface)
      : toView(c.crop, kept.frame.surface)
    : toView(c.crop, surface);
  // A live frame is on screen: tell the capture how long it took, so slow phones get more time between frames.
  useEffect(() => {
    if (!live || !frameStart.current) return;
    live.reportCost(performance.now() - frameStart.current);
    frameStart.current = 0;
  }, [picked, live]);

  // Pin lock. Locked (default): the pins follow the image. Unlocked: the user taps pins, and those edits win over
  // every setting. Edits (and the unlock) belong to the picture they were made on: a new picture discards them and
  // locks again. During a live share that means the screen changed enough to change the automatic pins.
  const autoKey = result ? cellsToString(result) : '';
  const edit = editState && (editState.picked === analysed || (live && editState.auto === autoKey)) ? editState : null;
  const pinsUnlocked = !!edit?.unlocked;
  /** What the user gets: their edited pins, or the automatic result. */
  const shown = edit?.pattern ?? result;
  // Send Live to Board: off until asked for, and only while live.
  const [liveSendOn, setLiveSendOn] = useState(false);
  const liveSend = useLiveSend(liveSendOn && !!live, live ? shown : null);
  const toggleLock = () => {
    if (!analysed) return;
    const unlocked = !pinsUnlocked;
    setEditState({ picked: analysed, auto: autoKey, pattern: edit?.pattern ?? null, unlocked });
    AccessibilityInfo.announceForAccessibility(unlocked ? 'Pins unlocked. Tap a pin to raise or lower it.' : 'Pins locked');
  };
  const togglePinAt = (row: number, col: number) => {
    if (!analysed || !shown || !pinsUnlocked) return;
    setEditState({ picked: analysed, auto: autoKey, pattern: togglePin(shown, row, col), unlocked: true });
  };
  const resetPins = () => {
    if (!analysed || !edit) return;
    setEditState({ ...edit, picked: analysed, auto: autoKey, pattern: null });
    AccessibilityInfo.announceForAccessibility('Pins reset to the image');
  };

  const resetForNewImage = () => {
    lock.release();
    dropCapture();
    setManualCrop(null);
    setFocus(null);
    c.resetGraph();
    prefs.resetForNewPicture();
    setEditState(null);
  };

  /** Photos, drops and pastes end up here. */
  const load = async (
    source: ImageSource,
    /** A capture from the live camera: keeps what the user tapped or cropped (given at `fromWidth`), rescaled. */
    keep?: { focus: Focus | null; crop: Rect | null; fromWidth: number },
  ) => {
    setError(null);
    setLoading(true);
    try {
      const raster = await loadImagePixels(source.uri, source.width ?? 0, source.height ?? 0);
      live?.stop();
      setLive(null);
      setPicked({ uri: source.uri, fileUri: raster.fileUri, raster, rgb: toRgb(raster), fromCamera: !!keep });
      resetForNewImage();
      if (keep && keep.fromWidth > 0) {
        const k = raster.width / keep.fromWidth;
        if (keep.focus) setFocus({ ...keep.focus, x: keep.focus.x * k, y: keep.focus.y * k });
        if (keep.crop) setManualCrop({ x: keep.crop.x * k, y: keep.crop.y * k, width: keep.crop.width * k, height: keep.crop.height * k });
      }
      AccessibilityInfo.announceForAccessibility(
        keep ? 'Photo captured. The camera is off.' : 'Image converted to pin preview, cropped to the main subject',
      );
    } catch (e) {
      setError(`Could not read that image: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  /** A typed equation: drawn as a plot with a known scale, then treated like any other picture. */
  const [equationError, setEquationError] = useState<string | null>(null);
  const drawEquation = (text: string) => {
    try {
      const { raster, scale } = renderEquation(parseEquation(text));
      const rgb = toRgb(raster);
      live?.stop();
      setLive(null);
      setError(null);
      setEquationError(null);
      const uri = rgbToPngDataUri(renderCrop(rgb, raster.width, raster.height, null, fullRect(raster.width, raster.height)));
      setPicked({ uri, raster, rgb, equation: { text, scale } });
      resetForNewImage();
      AccessibilityInfo.announceForAccessibility(`Drew ${text}`);
    } catch (e) {
      setEquationError(e instanceof Error ? e.message : String(e));
    }
  };

  const pick = async () => {
    setError(null);
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (res.canceled || !res.assets?.length) return;
    const asset = res.assets[0];
    await load({ uri: asset.uri, width: asset.width, height: asset.height });
  };

  /** Ends live input on a still picture: the camera's kept frame (and what it focused on), else the last frame. */
  const keepLastFrame = useCallback(() => {
    const k = keptRef.current;
    const camera = liveRef.current?.kind === 'camera';
    setLive(null);
    if (k) {
      setPicked(asStill(k.frame, true));
      setFocus(k.focus);
    } else setPicked((p) => asStill(p, camera));
    setCapture(null);
    setWatch({ for: null, w: null });
  }, []);

  /** Starts screen sharing or the live camera; both feed the same pipeline, frame by frame. */
  const startLive = async (source: LiveSource) => {
    setError(null);
    try {
      const session = await startLiveCapture({
        source,
        onFrame: (raster, surface) => {
          frameStart.current = performance.now();
          const rgb = toRgb(raster);
          // The camera found (or lost) a flat surface to flatten: pictures and coordinates switch between the camera
          // view and the flattened page, so whatever was tapped, cropped or locked starts over.
          if (!!surface !== onSurface.current) {
            onSurface.current = !!surface;
            lock.release();
            setFocus(null);
            setManualCrop(null);
          }
          // The camera follows its locked item: the smart crop is pointed at where it is in this frame.
          if (source === 'camera') {
            const toLens = surface
              ? (p: Point) => {
                  const f = surface.toFrame(p);
                  return { x: f.x / surface.frameWidth, y: f.y / surface.frameHeight };
                }
              : undefined;
            const at = lock.follow(rgb, raster.width, raster.height, toLens);
            if (at !== undefined) setFocus(at);
          }
          setPicked({ uri: '', raster, rgb, surface });
          // Keep the user's crop while sharing, unless the shared window shrank under it.
          setManualCrop((r) => (r && (r.x + r.width > raster.width + 0.5 || r.y + r.height > raster.height + 0.5) ? null : r));
        },
        onEnd: keepLastFrame,
        // 0 in focus, 1 refocusing (a frame or two), 2 struggling (about 2 s): shown on the picture.
        onFocus: (blurryFor) => setFocusTrouble(blurryFor >= 8 ? 2 : blurryFor >= 2 ? 1 : 0),
        onDark: setTooDark,
      });
      if (!session) return;
      live?.stop();
      resetForNewImage();
      setLive(session);
      AccessibilityInfo.announceForAccessibility(
        source === 'camera'
          ? 'Camera on. Once it locks onto something, the pins hold still on it. Tap the picture to switch to another thing.'
          : 'Sharing screen. The pin preview updates live.',
      );
    } catch (e) {
      setError(`${source === 'camera' ? 'Camera' : 'Screen sharing'} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  /** Stops the screen share or camera and keeps the last frame as a still picture. */
  const stopLive = () => {
    live?.stop();
    keepLastFrame();
  };

  /**
   * Takes a photo from the live camera and continues with it as a still picture (like a chosen photo, so Smart
   * Cut-Out can help with busy backgrounds). What was tapped or cropped carries over.
   */
  const capturePhoto = async () => {
    if (live?.kind !== 'camera') return;
    try {
      const uri = await live.snapshot();
      await load({ uri }, { focus, crop: manualCrop, fromWidth: w });
    } catch (e) {
      setError(`Capture failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  /** Back camera <-> front camera. A different view: the crop, tap and graph scale start over. */
  const flipCamera = async () => {
    if (!live) return;
    try {
      await live.flip();
      resetForNewImage();
      AccessibilityInfo.announceForAccessibility(live.facing === 'user' ? 'Front camera' : 'Back camera');
    } catch (e) {
      setError(`Camera failed: ${e instanceof Error ? e.message : String(e)}`);
      stopLive();
    }
  };

  // Leaving the Image tab turns the camera off (it would keep running, and filming, out of sight). The last frame
  // stays as a still picture. A screen share keeps going: the pins can follow it from the Display tab.
  useEffect(() => {
    liveRef.current = live;
    keptRef.current = kept;
  });
  useFocusEffect(
    useCallback(
      () => () => {
        const l = liveRef.current;
        if (l?.kind !== 'camera') return;
        l.stop();
        keepLastFrame();
      },
      [keepLastFrame],
    ),
  );

  /** Back to the empty Image tab: stops any screen share and forgets the image, crop and per-image settings. */
  const clearImage = () => {
    live?.stop();
    setLive(null);
    setPicked(null);
    setError(null);
    resetForNewImage();
    AccessibilityInfo.announceForAccessibility('Image cleared');
  };

  const dropping = useImageDrop(load, setError);

  const board = useBoardActions();
  /** Sends the result, and makes it the preview so the Display tab shows what the board has. */
  const sendResult = () => {
    if (!shown) return;
    setPattern(shown, 'From image');
    void board.sendPattern(shown);
  };

  const use = () => {
    if (!shown) return;
    setPattern(shown, 'From image');
    router.navigate('/');
  };

  const gridAspect = (GRID.cols * GRID.pinPitchRatio) / GRID.rows;

  return (
    <View style={{ flex: 1 }}>
      <Screen
        title="Image"
        // Native: hold the scroll view still while the crop box is dragged. Web: never toggle it, because hiding the
        // page scrollbar changes the content width and makes the whole picture jump; the crop area blocks touch scrolling itself.
        scrollEnabled={Platform.OS === 'web' || !dragging}>
        {!picked || !fg ? (
          <ImageSourcePicker
            loading={loading}
            onPick={pick}
            onCamera={supportsCamera ? () => startLive('camera') : undefined}
            onScreen={supportsScreenCapture ? () => startLive('screen') : undefined}
            dropHint={supportsFileDrop}
            onEquation={drawEquation}
            equationError={equationError}
          />
        ) : (
          <Columns
            rightWidth={420}
            left={
              <>
                <Section title="Crop">
                  <CropEditor
                    uri={picked.uri}
                    backdrop={live ? <LiveVideo video={live.video} /> : undefined}
                    badge={
                      live ? <LiveBadge focusing={cameraTrouble > 0} locked={lock.locked} captured={!!kept} flattened={!!surface} /> : undefined
                    }
                    // A flattened page is analysed, but the camera view is shown: boxes and taps are mapped between them.
                    imageWidth={surface?.frameWidth ?? picked.raster.width}
                    imageHeight={surface?.frameHeight ?? picked.raster.height}
                    crop={viewCrop}
                    onChange={(r) => {
                      // Your own box is fixed in the picture: the camera stops following an item.
                      lock.release();
                      dropCapture();
                      setManualCrop(surface ? mapRect(r, surface.toPage, { width: picked.raster.width, height: picked.raster.height }) : r);
                    }}
                    focus={manualCrop || !focus ? null : surface ? surface.toFrame(focus) : focus}
                    onTap={(seen) => {
                      const point = surface ? surface.toPage(seen) : seen;
                      // Tap a picture, a curve or a subject: the smart crop focuses on it (your own box gives way to it).
                      setManualCrop(null);
                      setFocus({ ...point, tap: true });
                      prefs.set('graphPan', NO_PAN);
                      if (live?.kind === 'camera') {
                        // Lock onto the tapped item from now on (another graph may have other units: read them again),
                        // and focus the lens there (where the browser allows it).
                        lock.tap(point, picked.rgb);
                        dropCapture();
                        c.resetGraph();
                        const vw = surface?.frameWidth ?? w;
                        const vh = surface?.frameHeight ?? h;
                        if (vw && vh) live.focusAt(seen.x / vw, seen.y / vh).catch(() => {});
                      }
                      AccessibilityInfo.announceForAccessibility(
                        live?.kind === 'camera' ? 'Locked onto what you tapped' : 'Cropped to what you tapped',
                      );
                    }}
                    onDragging={setDragging}
                  />
                  {cameraDark ? (
                    <StatusBanner
                      tone="neutral"
                      title="Too dark to see"
                      message="Turn on a light, or point the camera at something lit. The pins keep their last picture meanwhile."
                    />
                  ) : live?.shared === 'screen' ? (
                    <StatusBanner
                      tone="neutral"
                      title="Sharing the entire screen"
                      message="PinVisual can see itself, and other windows, which confuses it. Stop Sharing, then share just the window with your graph or shape."
                    />
                  ) : cameraTrouble === 2 ? (
                    <StatusBanner
                      tone="neutral"
                      title="Hard to focus"
                      message="Hold the phone a little further back (about 15 cm or more), keep it still, and tap what you want sharp."
                    />
                  ) : null}
                  <View style={styles.buttonRow}>
                    <Button
                      title="Auto Crop"
                      icon="sparkles"
                      variant="secondary"
                      compact
                      style={{ flex: 1 }}
                      disabled={!manualCrop && !focus}
                      onPress={() => {
                        lock.release();
                        dropCapture();
                        setManualCrop(null);
                        setFocus(null);
                      }}
                      accessibilityHint="Crops to the main subject again"
                    />
                    {live ? (
                      // While live, Stop (below) already ends it; this slot frames the whole picture.
                      <Button
                        title={live.kind === 'camera' ? 'Whole View' : 'Whole Screen'}
                        icon="fullscreen"
                        variant="secondary"
                        compact
                        style={{ flex: 1 }}
                        onPress={() => {
                          dropCapture();
                          setManualCrop(fullRect(picked.raster.width, picked.raster.height));
                        }}
                        accessibilityHint={`Uses the whole ${live.kind === 'camera' ? 'camera view' : 'shared screen'} instead of the automatic crop`}
                      />
                    ) : (
                      <Button
                        title="Clear Image"
                        icon="close"
                        variant="destructive"
                        compact
                        style={{ flex: 1 }}
                        onPress={clearImage}
                        accessibilityHint="Removes the image and returns to the start"
                      />
                    )}
                  </View>
                  {live?.kind === 'camera' ? (
                    <>
                      <View style={styles.buttonRow}>
                        <Button
                          title="Capture"
                          icon="camera"
                          compact
                          style={{ flex: 1 }}
                          onPress={capturePhoto}
                          loading={loading}
                          accessibilityLabel="Capture photo"
                          accessibilityHint="Takes a photo of what the camera sees and turns the camera off"
                        />
                        <Button
                          title="Stop Camera"
                          variant="destructive"
                          icon="stop"
                          compact
                          style={{ flex: 1 }}
                          onPress={stopLive}
                          accessibilityHint="Turns the camera off and keeps the last picture"
                        />
                      </View>
                      {live.canFlip ? (
                        <Button
                          title="Flip Camera"
                          variant="secondary"
                          icon="flip"
                          compact
                          onPress={flipCamera}
                          accessibilityHint={`Switches to the ${live.facing === 'user' ? 'back' : 'front'} camera`}
                        />
                      ) : null}
                    </>
                  ) : (
                    <View style={styles.buttonRow}>
                      <Button
                        title={supportsScreenCapture || supportsCamera ? 'New Photo' : 'Choose Another Photo'}
                        variant="secondary"
                        icon="photo"
                        compact
                        style={{ flex: 1 }}
                        onPress={pick}
                        loading={loading}
                      />
                      {live ? (
                        <Button title="Stop Sharing" variant="destructive" icon="stop" compact style={{ flex: 1 }} onPress={stopLive} />
                      ) : (
                        <>
                          {supportsCamera ? (
                            <Button
                              title="Camera"
                              variant="secondary"
                              icon="camera"
                              compact
                              style={{ flex: 1 }}
                              onPress={() => startLive('camera')}
                              disabled={loading}
                              accessibilityLabel="Live camera"
                              accessibilityHint={CAMERA_HINT}
                            />
                          ) : null}
                          {supportsScreenCapture ? (
                            <Button
                              title="Share Screen"
                              variant="secondary"
                              icon="screen"
                              compact
                              style={{ flex: 1 }}
                              onPress={() => startLive('screen')}
                              disabled={loading}
                              accessibilityHint={SCREEN_HINT}
                            />
                          ) : null}
                        </>
                      )}
                    </View>
                  )}
                </Section>

                <Section title="What the pins see">
                  <View style={[styles.frame, { aspectRatio: gridAspect, borderColor: t.separator }]}>
                    {c.cleanedUri ? (
                      <Image
                        source={{ uri: c.cleanedUri }}
                        contentFit={c.stretch ? 'fill' : 'contain'}
                        style={StyleSheet.absoluteFill}
                        accessibilityLabel={removeBackground ? 'Cropped image with the background removed' : 'Cropped image'}
                      />
                    ) : null}
                  </View>
                  {c.cuttingOut ? (
                    <StatusBanner tone="progress" title="Cutting out subject…" />
                  ) : c.cutoutError ? (
                    <StatusBanner tone="warning" title="Smart Cut-Out unavailable" message={c.cutoutError} />
                  ) : removeBackground && !fg.subject ? (
                    <StatusBanner tone="warning" title="No subject found" message={c.cutoutOn ? undefined : 'Try a lower Tolerance.'} />
                  ) : c.landscape ? (
                    <StatusBanner
                      tone="neutral"
                      title="Landscape"
                      message="The pins show the skyline: the land raised, the sky lowered. Tap something in the picture to show just that."
                    />
                  ) : null}
                </Section>
              </>
            }
            right={
              <>
                <ConversionSettings
                  settings={prefs.settings}
                  set={prefs.set}
                  conversion={c}
                  live={!!live}
                  equation={picked.equation?.text ?? null}
                  onEquation={drawEquation}
                  equationError={equationError}
                />

                {shown ? (
                  <ImageResult
                    pattern={shown}
                    unlocked={pinsUnlocked}
                    edited={!!edit?.pattern}
                    onToggleLock={toggleLock}
                    onTogglePin={togglePinAt}
                    onReset={resetPins}
                    onUse={use}
                    onSave={() => setSaveOpen(true)}
                    board={{ connected: board.connected, command: board.state.command, onSend: sendResult, onClear: () => void board.lowerPins(false) }}
                    liveSend={live ? { on: liveSendOn, onChange: setLiveSendOn, connected: liveSend.connected, error: liveSend.error } : undefined}
                  />
                ) : null}
              </>
            }
          />
        )}

        {error ? <StatusBanner tone="error" title="Image not converted" message={error} /> : null}
      </Screen>
      {dropping ? <DropOverlay /> : null}
      {shown ? (
        <SavePatternSheet
          visible={saveOpen}
          pattern={shown}
          onClose={() => setSaveOpen(false)}
          onSaved={(name) => {
            setSaveOpen(false);
            AccessibilityInfo.announceForAccessibility(`Saved ${name}`);
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  buttonRow: { flexDirection: 'row', gap: space.sm },
  frame: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
});
