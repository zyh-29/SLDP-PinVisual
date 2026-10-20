import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, View } from 'react-native';

import { GRID } from '@/config/hardware';
import { cellsToString, type Pattern, togglePin } from '@/domain/pattern';
import { toGrayscale } from '@/imaging/convert';
import { DEFAULT_PIN_FILL, toRgb } from '@/imaging/foreground';
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
import { smartCutoutAvailable } from '@/imaging/segment';
import { usePattern } from '@/state/PatternProvider';
import type { Focus } from '@/imaging/smartCrop';
import { mapRect } from '@/imaging/surface';
import { useCameraLock, useLockTarget } from '@/state/useCameraLock';
import { useLiveSend } from '@/state/useLiveSend';
import { type GraphRange, type PickedImage, useImageConversion } from '@/state/useImageConversion';
import { Button, Columns, Label, Screen, Section, Separator, StatusBanner } from '@/ui/components';
import { CropEditor } from '@/ui/CropEditor';
import { GraphRangeControl } from '@/ui/GraphRangeControl';
import { Icon } from '@/ui/Icon';
import { EquationInput } from '@/ui/EquationInput';
import { DropOverlay, LiveBadge } from '@/ui/ImageOverlays';
import { ImageResult } from '@/ui/ImageResult';
import { LiveVideo } from '@/ui/LiveVideo';
import { SavePatternSheet } from '@/ui/SavePatternSheet';
import { SliderRow, SwitchRow } from '@/ui/SettingRows';
import { radius, space, useTheme } from '@/ui/theme';

const CAMERA_HINT = 'Turns on the camera. The pins follow what it sees; tap the picture to focus on one thing.';
const SCREEN_HINT = 'Share a screen or window. The pins follow it live; crop the part you want.';

/** A live frame kept as a still picture: it gets an image of its own for the crop view. */
const asStill = (p: PickedImage | null): PickedImage | null =>
  p && !p.uri
    ? { ...p, uri: rgbToPngDataUri(renderCrop(p.rgb, p.raster.width, p.raster.height, null, fullRect(p.raster.width, p.raster.height))) }
    : p;

export default function ImageScreen() {
  const t = useTheme();
  const { setPattern } = usePattern();
  const [picked, setPicked] = useState<PickedImage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [removeBackground, setRemoveBackground] = useState(true);
  const [removeClutter, setRemoveClutter] = useState(true);
  /** null = automatic: chosen from each image (and crop) by the triangle method on colour distances. */
  const [toleranceOverride, setToleranceOverride] = useState<number | null>(null);
  /** Higher raises more pins. A pin is raised when at least (100 - sensitivity)% of it is subject. */
  const [sensitivity, setSensitivity] = useState(100 - Math.round(DEFAULT_PIN_FILL * 100));
  const [snap, setSnap] = useState(true);
  /** null = automatic: Smart Cut-Out runs when the background is busy. */
  const [cutoutOverride, setCutoutOverride] = useState<boolean | null>(null);
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
  const [linesOverride, setLinesOverride] = useState<boolean | null>(null);
  const [live, setLive] = useState<LiveCapture | null>(null);
  /** Live camera focus: 0 sharp, 1 refocusing, 2 can't get sharp. */
  const [focusTrouble, setFocusTrouble] = useState<0 | 1 | 2>(0);
  const cameraTrouble = live?.kind === 'camera' ? focusTrouble : 0;
  /** Live camera: the picture is essentially black (analysis paused). */
  const [tooDark, setTooDark] = useState(false);
  const cameraDark = live?.kind === 'camera' && tooDark;
  /** Graphs: how much of the graph the pins show (around the curve's vertex or middle), at its true proportions. */
  const [graphRange, setGraphRange] = useState<GraphRange>('5');
  /** The graph window moved with the arrows (units, right and up); back to the curve for each new graph. */
  const [graphPan, setGraphPan] = useState(NO_PAN);
  const [thinLines, setThinLines] = useState(true);

  // Stop screen sharing when the session is replaced or the screen goes away.
  useEffect(() => () => live?.stop(), [live]);

  // Live camera: stay locked onto the item found (or tapped) while the phone moves.
  const lock = useCameraLock(live);
  /** When the frame being analysed arrived: its cost (arrival to on screen) paces the live capture. */
  const frameStart = useRef(0);
  /** The camera is delivering a flattened surface (see onFrame). */
  const onSurface = useRef(false);
  const c = useImageConversion(picked, live, {
    removeBackground,
    removeClutter,
    toleranceOverride,
    pinFill: (100 - sensitivity) / 100,
    snap,
    cutoutOverride,
    manualCrop,
    focus,
    linesOverride,
    graphRange,
    graphPan,
    thinLines,
    trackedWidth: lock.width,
    trackedBox: lock.box,
  });
  const { width: w, height: h, fg, result, graph, shape } = c;
  /** Live camera on a flat surface: the analysed picture is the flattened page (see onFrame). */
  const surface = live?.kind === 'camera' ? picked?.surface : undefined;
  const view = surface ? { width: surface.frameWidth, height: surface.frameHeight } : undefined;
  useLockTarget(lock, picked, c.target);
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
  const edit = editState && (editState.picked === picked || (live && editState.auto === autoKey)) ? editState : null;
  const pinsUnlocked = !!edit?.unlocked;
  /** What the user gets: their edited pins, or the automatic result. */
  const shown = edit?.pattern ?? result;
  // Send Live to Board: off until asked for, and only while live.
  const [liveSendOn, setLiveSendOn] = useState(false);
  const liveSend = useLiveSend(liveSendOn && !!live, live ? shown : null);
  const toggleLock = () => {
    if (!picked) return;
    const unlocked = !pinsUnlocked;
    setEditState({ picked, auto: autoKey, pattern: edit?.pattern ?? null, unlocked });
    AccessibilityInfo.announceForAccessibility(unlocked ? 'Pins unlocked. Tap a pin to raise or lower it.' : 'Pins locked');
  };
  const togglePinAt = (row: number, col: number) => {
    if (!picked || !shown || !pinsUnlocked) return;
    setEditState({ picked, auto: autoKey, pattern: togglePin(shown, row, col), unlocked: true });
  };
  const resetPins = () => {
    if (!picked || !edit) return;
    setEditState({ ...edit, picked, auto: autoKey, pattern: null });
    AccessibilityInfo.announceForAccessibility('Pins reset to the image');
  };

  const resetForNewImage = () => {
    lock.release();
    setManualCrop(null);
    setFocus(null);
    c.resetGraph();
    setGraphPan(NO_PAN);
    setLinesOverride(null);
    setCutoutOverride(null);
    setToleranceOverride(null);
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
      setPicked({ uri: source.uri, fileUri: raster.fileUri, raster, rgb: toRgb(raster), gray: toGrayscale(raster), fromCamera: !!keep });
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
      setPicked({ uri, raster, rgb, gray: toGrayscale(raster), equation: { text, scale } });
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

  /** Keeps the last shared frame as a still image. */
  const freeze = () => {
    setLive(null);
    setPicked(asStill);
  };

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
          setPicked({ uri: '', raster, rgb, gray: toGrayscale(raster), surface });
          // Keep the user's crop while sharing, unless the shared window shrank under it.
          setManualCrop((r) => (r && (r.x + r.width > raster.width + 0.5 || r.y + r.height > raster.height + 0.5) ? null : r));
        },
        onEnd: freeze,
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
          ? 'Camera on. The pin preview follows what the camera sees. Tap the picture to focus on one thing.'
          : 'Sharing screen. The pin preview updates live.',
      );
    } catch (e) {
      setError(`${source === 'camera' ? 'Camera' : 'Screen sharing'} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  /** Stops the screen share or camera and keeps the last frame as a still picture. */
  const stopLive = () => {
    live?.stop();
    freeze();
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
  const liveRef = useRef(live);
  useEffect(() => {
    liveRef.current = live;
  });
  useFocusEffect(
    useCallback(
      () => () => {
        const l = liveRef.current;
        if (l?.kind !== 'camera') return;
        l.stop();
        setLive(null);
        setPicked(asStill);
      },
      [],
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
          <Section padded style={{ maxWidth: 560, width: '100%', alignSelf: 'center' }}>
            <View style={styles.empty}>
              <View style={[styles.emptyIcon, { backgroundColor: t.tintSoft }]}>
                <Icon name="photo" color={t.tint} size={30} />
              </View>
              <Label variant="title3" style={{ textAlign: 'center' }}>
                Turn a picture into pins
              </Label>
            </View>
            <Button title="Choose Photo" icon="photo" onPress={pick} loading={loading} />
            {supportsCamera ? (
              <Button
                title="Live Camera"
                icon="camera"
                variant="secondary"
                onPress={() => startLive('camera')}
                disabled={loading}
                accessibilityHint={CAMERA_HINT}
              />
            ) : null}
            {supportsScreenCapture ? (
              <Button
                title="Share Screen"
                icon="screen"
                variant="secondary"
                onPress={() => startLive('screen')}
                disabled={loading}
                accessibilityHint={SCREEN_HINT}
              />
            ) : null}
            {supportsFileDrop ? (
              <Label variant="footnote" secondary style={{ textAlign: 'center' }}>
                or drop an image here
              </Label>
            ) : null}
            <Separator />
            <Label variant="headline">Or type an equation</Label>
            <EquationInput onDraw={drawEquation} error={equationError} />
          </Section>
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
                      live ? <LiveBadge focusing={cameraTrouble > 0} locked={lock.locked} flattened={!!surface} /> : undefined
                    }
                    // A flattened page is analysed, but the camera view is shown: boxes and taps are mapped between them.
                    imageWidth={surface?.frameWidth ?? w}
                    imageHeight={surface?.frameHeight ?? h}
                    crop={surface ? mapRect(c.crop, surface.toFrame, view) : c.crop}
                    onChange={(r) => {
                      // Your own box is fixed in the picture: the camera stops following an item.
                      lock.release();
                      setManualCrop(surface ? mapRect(r, surface.toPage, { width: w, height: h }) : r);
                    }}
                    focus={manualCrop || !focus ? null : surface ? surface.toFrame(focus) : focus}
                    onTap={(seen) => {
                      const point = surface ? surface.toPage(seen) : seen;
                      // Tap a picture, a curve or a subject: the smart crop focuses on it (your own box gives way to it).
                      setManualCrop(null);
                      setFocus({ ...point, tap: true });
                      setGraphPan(NO_PAN);
                      if (live?.kind === 'camera') {
                        // Lock onto the tapped item from now on (another graph may have other units: read them again),
                        // and focus the lens there (where the browser allows it).
                        lock.tap(point);
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
                        onPress={() => setManualCrop(fullRect(w, h))}
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
                  ) : null}
                </Section>
              </>
            }
            right={
              <>
                <Section title="Conversion">
                  {picked.equation ? (
                    <>
                      <EquationInput key={picked.equation.text} initial={picked.equation.text} onDraw={drawEquation} error={equationError} />
                      <Separator />
                    </>
                  ) : null}
                  {graph ? (
                    <>
                      <GraphRangeControl
                        graph={graph}
                        range={graphRange}
                        onChange={setGraphRange}
                        readingNumbers={c.readingNumbers}
                        pan={graphPan}
                        live={!!live}
                        onPan={(p) => {
                          setGraphPan(p);
                          AccessibilityInfo.announceForAccessibility(
                            p.x === 0 && p.y === 0 ? 'Back on the curve' : `Moved ${Math.abs(p.x)} ${p.x < 0 ? 'left' : 'right'}, ${Math.abs(p.y)} ${p.y < 0 ? 'down' : 'up'}`,
                          );
                        }}
                      />
                      <Separator />
                    </>
                  ) : null}
                  <SwitchRow
                    title="Remove Background"
                    hint="Anything that differs from the edge colour counts as the subject"
                    value={removeBackground}
                    onChange={setRemoveBackground}
                  />
                  {removeBackground ? (
                    <>
                      {smartCutoutAvailable && !live && (c.busyPhoto || cutoutOverride !== null) ? (
                        <>
                          <Separator />
                          <SwitchRow
                            title="Smart Cut-Out"
                            hint="Uses on-device AI to separate the main subject from a busy background"
                            value={c.cutoutOn}
                            onChange={setCutoutOverride}
                          />
                        </>
                      ) : null}
                      {fg.lines.length > 0 || linesOverride !== null ? (
                        <>
                          <Separator />
                          <SwitchRow
                            title="Remove Axes & Grid"
                            hint="Removes long straight lines such as graph axes and gridlines, and stretches the graph to fill the pins"
                            value={fg.linesRemoved}
                            onChange={setLinesOverride}
                          />
                        </>
                      ) : null}
                      <Separator />
                      <SwitchRow
                        title="Ignore Labels & Text"
                        hint="Drops labels, text and specks much smaller than the main shape"
                        value={removeClutter}
                        onChange={setRemoveClutter}
                      />
                      {c.shapesApply && shape ? (
                        <>
                          <Separator />
                          <SwitchRow
                            title={`Snap to ${shape.name}`}
                            hint={`Draws a perfect ${shape.name.toLowerCase()} on the pins instead of following the pixels`}
                            value={snap}
                            onChange={setSnap}
                          />
                        </>
                      ) : null}
                    </>
                  ) : null}
                  {removeBackground && c.curves ? (
                    <>
                      <Separator />
                      <SwitchRow
                        title="One-Pin Lines"
                        hint="Draws graph curves as a line one pin wide, following the curve's centre, instead of every pin they touch"
                        value={thinLines}
                        onChange={setThinLines}
                      />
                    </>
                  ) : null}
                  {/* Tolerance only matters when the subject is separated by colour (not by a curve's colour or the AI). */}
                  {removeBackground && !c.subjectKnown ? (
                    <>
                      <Separator />
                      <SliderRow
                        title="Tolerance"
                        value={fg.tolerance}
                        display={toleranceOverride === null ? `Auto · ${fg.tolerance}` : String(toleranceOverride)}
                        min={8}
                        max={160}
                        step={2}
                        onChange={setToleranceOverride}
                        onAuto={toleranceOverride === null ? undefined : () => setToleranceOverride(null)}
                        hint="Set automatically for each image. Higher ignores faint colours, shadows and paper texture; lower keeps pale fills."
                      />
                    </>
                  ) : null}
                  {c.traced ? null : (
                    <>
                      <Separator />
                      <SliderRow
                        title="Sensitivity"
                        value={sensitivity}
                        display={`${sensitivity}%`}
                        min={5}
                        max={95}
                        step={5}
                        onChange={setSensitivity}
                        hint={`Higher raises more pins. A pin is raised when at least ${100 - sensitivity}% of it is ${removeBackground ? 'subject' : 'dark'}.`}
                      />
                    </>
                  )}
                </Section>

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

const NO_PAN = { x: 0, y: 0 };

const styles = StyleSheet.create({
  empty: { alignItems: 'center', gap: space.sm, paddingVertical: space.lg },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
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
