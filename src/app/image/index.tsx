import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, View } from 'react-native';

import { GRID } from '@/config/hardware';
import { cellsToString, type Pattern, togglePin } from '@/domain/pattern';
import { toGrayscale } from '@/imaging/convert';
import { DEFAULT_PIN_FILL, toRgb } from '@/imaging/foreground';
import { fullRect, type Point, type Rect } from '@/imaging/geometry';
import {
  type ImageSource,
  type LiveCapture,
  startLiveCapture,
  supportsFileDrop,
  supportsScreenCapture,
  useImageDrop,
} from '@/imaging/imageInput';
import { loadImagePixels } from '@/imaging/loadImage';
import { renderCrop } from '@/imaging/pinSampling';
import { rgbToPngDataUri } from '@/imaging/previewPng';
import { smartCutoutAvailable } from '@/imaging/segment';
import { usePattern } from '@/state/PatternProvider';
import { type GraphRange, type PickedImage, useImageConversion } from '@/state/useImageConversion';
import { Button, Columns, Label, Screen, Section, Separator, StatusBanner } from '@/ui/components';
import { CropEditor } from '@/ui/CropEditor';
import { GraphRangeControl } from '@/ui/GraphRangeControl';
import { Icon } from '@/ui/Icon';
import { DropOverlay, LiveBadge } from '@/ui/ImageOverlays';
import { ImageResult } from '@/ui/ImageResult';
import { LiveVideo } from '@/ui/LiveVideo';
import { SavePatternSheet } from '@/ui/SavePatternSheet';
import { SliderRow, SwitchRow } from '@/ui/SettingRows';
import { radius, space, useTheme } from '@/ui/theme';

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
  const [focus, setFocus] = useState<Point | null>(null);
  const [dragging, setDragging] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  /** The user's pin edits and lock state, tied to the picture they were made on (see the pin lock below). */
  const [editState, setEditState] = useState<{ picked: PickedImage; auto: string; pattern: Pattern | null; unlocked: boolean } | null>(
    null,
  );
  /** null = automatic: axes and gridlines are removed when the image looks like a graph. */
  const [linesOverride, setLinesOverride] = useState<boolean | null>(null);
  const [live, setLive] = useState<LiveCapture | null>(null);
  /** Graphs: how much of the graph the pins show (around the curve's vertex or middle), at its true proportions. */
  const [graphRange, setGraphRange] = useState<GraphRange>('5');

  // Stop screen sharing when the session is replaced or the screen goes away.
  useEffect(() => () => live?.stop(), [live]);

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
  });
  const { width: w, height: h, fg, result, graph, shape } = c;

  // Pin lock. Locked (default): the pins follow the image. Unlocked: the user taps pins, and those edits win over
  // every setting. Edits (and the unlock) belong to the picture they were made on: a new picture discards them and
  // locks again. During a live share that means the screen changed enough to change the automatic pins.
  const autoKey = result ? cellsToString(result) : '';
  const edit = editState && (editState.picked === picked || (live && editState.auto === autoKey)) ? editState : null;
  const pinsUnlocked = !!edit?.unlocked;
  /** What the user gets: their edited pins, or the automatic result. */
  const shown = edit?.pattern ?? result;
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
    setManualCrop(null);
    setFocus(null);
    c.resetGraph();
    setLinesOverride(null);
    setCutoutOverride(null);
    setToleranceOverride(null);
    setEditState(null);
  };

  /** Photos, drops and pastes end up here. */
  const load = async (source: ImageSource) => {
    setError(null);
    setLoading(true);
    try {
      const raster = await loadImagePixels(source.uri, source.width ?? 0, source.height ?? 0);
      live?.stop();
      setLive(null);
      setPicked({ uri: source.uri, fileUri: raster.fileUri, raster, rgb: toRgb(raster), gray: toGrayscale(raster) });
      resetForNewImage();
      AccessibilityInfo.announceForAccessibility('Image converted to pin preview, cropped to the main subject');
    } catch (e) {
      setError(`Could not read that image: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
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
    setPicked((p) =>
      p && !p.uri
        ? {
            ...p,
            uri: rgbToPngDataUri(renderCrop(p.rgb, p.raster.width, p.raster.height, null, fullRect(p.raster.width, p.raster.height))),
          }
        : p,
    );
  };

  const startSharing = async () => {
    setError(null);
    try {
      const session = await startLiveCapture({
        onFrame: (raster) => {
          setPicked({ uri: '', raster, rgb: toRgb(raster), gray: toGrayscale(raster) });
          // Keep the user's crop while sharing, unless the shared window shrank under it.
          setManualCrop((r) => (r && (r.x + r.width > raster.width + 0.5 || r.y + r.height > raster.height + 0.5) ? null : r));
        },
        onEnd: freeze,
      });
      if (!session) return;
      live?.stop();
      resetForNewImage();
      setLive(session);
      AccessibilityInfo.announceForAccessibility('Sharing screen. The pin preview updates live.');
    } catch (e) {
      setError(`Screen sharing failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const stopSharing = () => {
    live?.stop();
    freeze();
  };

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
            {supportsScreenCapture ? (
              <Button
                title="Share Screen"
                icon="screen"
                variant="secondary"
                onPress={startSharing}
                disabled={loading}
                accessibilityHint="Share a screen or window. The pins follow it live; crop the part you want."
              />
            ) : null}
            {supportsFileDrop ? (
              <Label variant="footnote" secondary style={{ textAlign: 'center' }}>
                or drop an image here
              </Label>
            ) : null}
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
                    badge={live ? <LiveBadge /> : undefined}
                    imageWidth={w}
                    imageHeight={h}
                    crop={c.crop}
                    onChange={setManualCrop}
                    focus={manualCrop ? null : focus}
                    onTap={(point) => {
                      // Tap a picture, a curve or a subject: the smart crop focuses on it (your own box gives way to it).
                      setManualCrop(null);
                      setFocus(point);
                      AccessibilityInfo.announceForAccessibility('Cropped to what you tapped');
                    }}
                    onDragging={setDragging}
                  />
                  <View style={styles.buttonRow}>
                    <Button
                      title="Auto Crop"
                      icon="sparkles"
                      variant="secondary"
                      compact
                      style={{ flex: 1 }}
                      disabled={!manualCrop && !focus}
                      onPress={() => {
                        setManualCrop(null);
                        setFocus(null);
                      }}
                      accessibilityHint="Crops to the main subject again"
                    />
                    {live ? (
                      // While sharing, Stop Sharing (below) already ends the share; this slot frames the whole screen.
                      <Button
                        title="Whole Screen"
                        icon="fullscreen"
                        variant="secondary"
                        compact
                        style={{ flex: 1 }}
                        onPress={() => setManualCrop(fullRect(w, h))}
                        accessibilityHint="Uses the whole shared screen instead of the automatic crop"
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
                  <View style={styles.buttonRow}>
                    <Button
                      title={supportsScreenCapture ? 'New Photo' : 'Choose Another Photo'}
                      variant="secondary"
                      icon="photo"
                      compact
                      style={{ flex: 1 }}
                      onPress={pick}
                      loading={loading}
                    />
                    {live ? (
                      <Button title="Stop Sharing" variant="destructive" icon="stop" compact style={{ flex: 1 }} onPress={stopSharing} />
                    ) : supportsScreenCapture ? (
                      <Button
                        title="Share Screen"
                        variant="secondary"
                        icon="screen"
                        compact
                        style={{ flex: 1 }}
                        onPress={startSharing}
                        disabled={loading}
                        accessibilityHint="Share a screen or window. The pins follow it live; crop the part you want."
                      />
                    ) : null}
                  </View>
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
                  {graph ? (
                    <>
                      <GraphRangeControl graph={graph} range={graphRange} onChange={setGraphRange} readingNumbers={c.readingNumbers} />
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
