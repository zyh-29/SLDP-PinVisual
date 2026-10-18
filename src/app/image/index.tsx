import Slider from '@react-native-community/slider';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Switch, View } from 'react-native';

import { GRID } from '@/config/hardware';
import { type RasterImage, toGrayscale } from '@/imaging/convert';
import {
  DEFAULT_MIN_PIECE_RATIO,
  DEFAULT_PIN_FILL,
  DEFAULT_TOLERANCE,
  estimateBackground,
  findForeground,
  fullRect,
  inkFromGray,
  inkFromMask,
  cellSizePx,
  thickenThinLines,
  patternFromSamples,
  type Rect,
  renderCrop,
  sampleCrop,
  smartCrop,
  toRgb,
} from '@/imaging/foreground';
import {
  type ImageSource,
  type LiveCapture,
  startLiveCapture,
  supportsFileDrop,
  supportsScreenCapture,
  useImageDrop,
} from '@/imaging/imageInput';
import { loadImagePixels } from '@/imaging/loadImage';
import { segmentSubject, smartCutoutAvailable } from '@/imaging/segment';
import { detectShape, fillHoles, outlineOf, renderShape, type ShapeStyle } from '@/imaging/shapes';
import { rgbToPngDataUri } from '@/imaging/previewPng';
import { usePattern } from '@/state/PatternProvider';
import { Button, Columns, Label, Screen, Section, SegmentedControl, Separator, StatusBanner } from '@/ui/components';
import { CropEditor } from '@/ui/CropEditor';
import { Icon } from '@/ui/Icon';
import { LiveVideo } from '@/ui/LiveVideo';
import { PinGrid } from '@/ui/PinGrid';
import { radius, space, useTheme } from '@/ui/theme';

interface Picked {
  uri: string;
  /** Downscaled PNG on the device, for Smart Cut-Out (phones). */
  fileUri?: string;
  raster: RasterImage;
  rgb: Uint8ClampedArray;
  gray: Float32Array;
}

/** Above this border unevenness the background is probably a busy photo, not paper or a plain colour. */
const BUSY_BACKGROUND = 28;

export default function ImageScreen() {
  const t = useTheme();
  const { setPattern } = usePattern();
  const [picked, setPicked] = useState<Picked | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [removeBackground, setRemoveBackground] = useState(true);
  const [removeClutter, setRemoveClutter] = useState(true);
  const [tolerance, setTolerance] = useState(DEFAULT_TOLERANCE);
  /** Higher raises more pins. A pin is raised when at least (100 - sensitivity)% of it is subject. */
  const [sensitivity, setSensitivity] = useState(100 - Math.round(DEFAULT_PIN_FILL * 100));
  const pinFill = (100 - sensitivity) / 100;
  const [style, setStyle] = useState<ShapeStyle>('filled');
  const [snap, setSnap] = useState(true);
  /** null = automatic: Smart Cut-Out runs when the background is busy. */
  const [cutoutOverride, setCutoutOverride] = useState<boolean | null>(null);
  const [cutout, setCutout] = useState<{ for: Picked; mask: Float32Array | null; error?: string } | null>(null);
  const [invert, setInvert] = useState(false);
  /** null = automatic (smart crop). */
  const [manualCrop, setManualCrop] = useState<Rect | null>(null);
  const [dragging, setDragging] = useState(false);
  /** null = automatic: axes and gridlines are removed when the image looks like a graph. */
  const [linesOverride, setLinesOverride] = useState<boolean | null>(null);
  const [live, setLive] = useState<LiveCapture | null>(null);

  // Stop screen sharing when the session is replaced or the screen goes away.
  useEffect(() => () => live?.stop(), [live]);

  const w = picked?.raster.width ?? 0;
  const h = picked?.raster.height ?? 0;
  const minPieceRatio = removeClutter ? DEFAULT_MIN_PIECE_RATIO : 0;
  const removeLines = linesOverride ?? 'auto';

  // Smart Cut-Out (AI subject segmentation, on-device) for photos with a busy background.
  const busyPhoto = useMemo(() => (picked ? estimateBackground(picked.rgb, w, h).noise > BUSY_BACKGROUND : false), [picked, w, h]);
  const cutoutOn = removeBackground && smartCutoutAvailable && !live && (cutoutOverride ?? busyPhoto);
  const cuttingOut = cutoutOn && cutout?.for !== picked;
  const subjectMask = cutoutOn && cutout?.for === picked ? (cutout.mask ?? undefined) : undefined;
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

  // Whole image: finds the subject for the automatic crop.
  const fgAll = useMemo(
    () => (picked ? findForeground(picked.rgb, w, h, { tolerance, minPieceRatio, removeLines, subjectMask }) : null),
    [picked, w, h, tolerance, minPieceRatio, removeLines, subjectMask],
  );
  const autoCrop = useMemo(() => (fgAll ? smartCrop(fgAll) : null), [fgAll]);
  const crop = manualCrop ?? autoCrop ?? fullRect(w, h);
  // A manual crop is analysed on its own (background from its edge, labels judged within it).
  // If the whole image is a graph, a crop of it is too, even when only one axis is inside the crop.
  const fg = useMemo(() => {
    if (!picked || !manualCrop) return fgAll;
    const lines = linesOverride ?? (fgAll?.graphLikely ? true : 'auto');
    return findForeground(picked.rgb, w, h, { tolerance, minPieceRatio, removeLines: lines, region: manualCrop, subjectMask });
  }, [picked, w, h, tolerance, minPieceRatio, linesOverride, manualCrop, fgAll, subjectMask]);
  // Graphs have arbitrary x and y scales, so they stretch to use every pin.
  const stretch = removeBackground && !!fg?.linesRemoved;

  // Shapes (not graphs): close drawn outlines, then look for a clean triangle, square, circle...
  const shapesApply = removeBackground && !stretch && !invert;
  const filledMask = useMemo(() => (fg && shapesApply ? fillHoles(fg.mask, w, h, crop) : null), [fg, shapesApply, w, h, crop]);
  const shape = useMemo(() => (filledMask ? detectShape(filledMask, w, h, crop) : null), [filledMask, w, h, crop]);
  const styledMask = useMemo(
    () => (filledMask ? (style === 'filled' ? filledMask : outlineOf(filledMask, w, h)) : (fg?.mask ?? null)),
    [filledMask, style, fg, w, h],
  );

  const ink = useMemo(() => {
    if (!picked || !fg || !styledMask) return null;
    if (!removeBackground) return inkFromGray(picked.gray);
    if (invert) return inkFromMask(fg.mask);
    const cell = cellSizePx(crop, GRID.rows, GRID.cols, GRID.pinPitchRatio, stretch);
    const stroke = style === 'outline' && filledMask ? 1 : fg.strokeWidth;
    return inkFromMask(thickenThinLines(styledMask, w, h, stroke, cell));
  }, [picked, fg, styledMask, filledMask, style, removeBackground, invert, crop, stretch, w, h]);
  const samples = useMemo(
    () => (ink ? sampleCrop(ink, w, h, crop, GRID.rows, GRID.cols, GRID.pinPitchRatio, stretch) : null),
    [ink, w, h, crop, stretch],
  );
  const result = useMemo(() => {
    if (shape && snap && shapesApply) return renderShape(shape, GRID.rows, GRID.cols, GRID.pinPitchRatio, style, pinFill);
    return samples ? patternFromSamples(samples, GRID.rows, GRID.cols, pinFill, invert) : null;
  }, [shape, snap, shapesApply, style, pinFill, samples, invert]);
  const cleanedUri = useMemo(
    () =>
      picked && fg ? rgbToPngDataUri(renderCrop(picked.rgb, w, h, removeBackground ? (invert ? fg.mask : styledMask) : null, crop)) : null,
    [picked, fg, styledMask, invert, w, h, removeBackground, crop],
  );

  const resetForNewImage = () => {
    setManualCrop(null);
    setLinesOverride(null);
    setCutoutOverride(null);
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
          setManualCrop((c) => (c && (c.x + c.width > raster.width + 0.5 || c.y + c.height > raster.height + 0.5) ? null : c));
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

  const dropping = useImageDrop(load);

  const use = () => {
    if (!result) return;
    setPattern(result, 'From image');
    router.navigate('/');
  };

  const gridAspect = (GRID.cols * GRID.pinPitchRatio) / GRID.rows;
  const busy = !!fg && fg.borderNoise > BUSY_BACKGROUND;

  return (
    <View style={{ flex: 1 }}>
      <Screen title="Image" scrollEnabled={!dragging}>
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
                    backdrop={live ? <LiveVideo stream={live.stream} /> : undefined}
                    badge={live ? <LiveBadge /> : undefined}
                    imageWidth={w}
                    imageHeight={h}
                    crop={crop}
                    onChange={setManualCrop}
                    onDragging={setDragging}
                  />
                  <View style={styles.buttonRow}>
                    <Button
                      title="Auto Crop"
                      icon="sparkles"
                      variant="secondary"
                      compact
                      style={{ flex: 1 }}
                      disabled={!manualCrop}
                      onPress={() => setManualCrop(null)}
                      accessibilityHint="Crops to the main subject again"
                    />
                    <Button
                      title="Whole Image"
                      icon="fullscreen"
                      variant="secondary"
                      compact
                      style={{ flex: 1 }}
                      onPress={() => setManualCrop(fullRect(w, h))}
                    />
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
                    {cleanedUri ? (
                      <Image
                        source={{ uri: cleanedUri }}
                        contentFit={stretch ? 'fill' : 'contain'}
                        style={StyleSheet.absoluteFill}
                        accessibilityLabel={removeBackground ? 'Cropped image with the background removed' : 'Cropped image'}
                      />
                    ) : null}
                  </View>
                  {cuttingOut ? (
                    <StatusBanner tone="progress" title="Cutting out subject…" />
                  ) : cutoutOn && cutout?.error ? (
                    <StatusBanner tone="warning" title="Smart Cut-Out unavailable" message={cutout.error} />
                  ) : removeBackground && !fg.subject ? (
                    <StatusBanner tone="warning" title="No subject found" message={cutoutOn ? undefined : 'Try a lower Tolerance.'} />
                  ) : removeBackground && busy && !cutoutOn ? (
                    <StatusBanner tone="warning" title="Busy background" message="Crop closer or raise Tolerance." />
                  ) : null}
                </Section>
              </>
            }
            right={
              <>
                <Section title="Conversion">
                  <SwitchRow
                    title="Remove Background"
                    hint="Anything that differs from the edge colour counts as the subject"
                    value={removeBackground}
                    onChange={setRemoveBackground}
                  />
                  {removeBackground ? (
                    <>
                      {smartCutoutAvailable && !live && (busyPhoto || cutoutOverride !== null) ? (
                        <>
                          <Separator />
                          <SwitchRow
                            title="Smart Cut-Out"
                            hint="Uses on-device AI to separate the main subject from a busy background"
                            value={cutoutOn}
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
                      {shapesApply && shape ? (
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
                      {shapesApply ? (
                        <>
                          <Separator />
                          <SegmentedControl
                            accessibilityLabel="Shape style"
                            value={style}
                            onChange={setStyle}
                            options={[
                              { value: 'filled', label: 'Filled' },
                              { value: 'outline', label: 'Outline' },
                            ]}
                          />
                        </>
                      ) : null}
                    </>
                  ) : null}
                  {removeBackground && !cutoutOn ? (
                    <>
                      <Separator />
                      <SliderRow
                        title="Tolerance"
                        value={tolerance}
                        display={String(tolerance)}
                        min={8}
                        max={160}
                        step={4}
                        onChange={setTolerance}
                        hint="Higher ignores faint colours, shadows and paper texture. Lower keeps pale fills."
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
                  <Separator />
                  <SwitchRow
                    title="Invert"
                    hint={removeBackground ? 'Raise the background instead of the subject' : 'Raise light areas instead of dark ones'}
                    value={invert}
                    onChange={setInvert}
                  />
                </Section>

                {result ? (
                  <Section title="Result">
                    <PinGrid pattern={result} />
                    <Button
                      title="Use This Pattern"
                      icon="edit"
                      onPress={use}
                      accessibilityHint="Replaces the preview on the Display tab, where you can edit and send it."
                    />
                  </Section>
                ) : null}
              </>
            }
          />
        )}

        {error ? <StatusBanner tone="error" title="Image not converted" message={error} /> : null}
      </Screen>
      {dropping ? <DropOverlay /> : null}
    </View>
  );
}

function LiveBadge() {
  return (
    <View style={styles.liveBadge} accessible accessibilityLabel="Live">
      <View style={styles.liveDot} />
      <Label variant="caption" style={{ color: '#FFFFFF', fontWeight: '600' }}>
        Live
      </Label>
    </View>
  );
}

/** Shown while an image file is dragged over the page (web). */
function DropOverlay() {
  const t = useTheme();
  return (
    <View pointerEvents="none" style={[styles.dropOverlay, { backgroundColor: t.background }]}>
      <View style={[styles.dropZone, { borderColor: t.tint, backgroundColor: t.tintSoft }]}>
        <Icon name="photo" color={t.tint} size={40} />
        <Label variant="title3" style={{ color: t.tint }}>
          Drop Image
        </Label>
      </View>
    </View>
  );
}

function SwitchRow({ title, hint, value, onChange }: { title: string; hint: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.switchRow}>
      <Label variant="body" style={{ flex: 1 }}>
        {title}
      </Label>
      <Switch value={value} onValueChange={onChange} accessibilityLabel={title} accessibilityHint={hint} />
    </View>
  );
}

function SliderRow(p: {
  title: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  hint: string;
  onChange: (v: number) => void;
}) {
  const t = useTheme();
  const set = (v: number) => p.onChange(Math.min(p.max, Math.max(p.min, Math.round(v / p.step) * p.step)));
  return (
    <View style={{ gap: space.xs }}>
      <View style={styles.sliderHeader}>
        <Label variant="body">{p.title}</Label>
        <Label variant="body" secondary style={{ fontVariant: ['tabular-nums'] }}>
          {p.display}
        </Label>
      </View>
      <View style={styles.sliderRow}>
        <Button
          title=""
          accessibilityLabel={`Decrease ${p.title}`}
          icon="minus"
          variant="secondary"
          compact
          style={styles.stepButton}
          onPress={() => set(p.value - p.step)}
        />
        <Slider
          style={{ flex: 1, height: 44 }}
          minimumValue={p.min}
          maximumValue={p.max}
          step={p.step}
          value={p.value}
          onValueChange={set}
          minimumTrackTintColor={t.tint}
          maximumTrackTintColor={t.fill}
          accessibilityLabel={p.title}
          accessibilityHint={p.hint}
          accessibilityValue={{
            min: p.min,
            max: p.max,
            now: p.value,
            text: p.display,
          }}
        />
        <Button
          title=""
          accessibilityLabel={`Increase ${p.title}`}
          icon="plus"
          variant="secondary"
          compact
          style={styles.stepButton}
          onPress={() => set(p.value + p.step)}
        />
      </View>
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
  sliderHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  sliderRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  stepButton: { width: 44, paddingHorizontal: 0 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 44,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF3B30' },
  dropOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    padding: space.lg,
  },
  dropZone: {
    flex: 1,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
});
