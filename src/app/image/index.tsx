import Slider from '@react-native-community/slider';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Switch, View } from 'react-native';

import { GRID } from '@/config/hardware';
import { countRaised } from '@/domain/pattern';
import { DEFAULT_THRESHOLD, type FitMode, patternFromLuminance, type RasterImage, sampleCells, toGrayscale } from '@/imaging/convert';
import { loadImagePixels } from '@/imaging/loadImage';
import { usePattern } from '@/state/PatternProvider';
import { Button, Columns, Label, Screen, Section, SegmentedControl, Separator, StatusBanner } from '@/ui/components';
import { Icon } from '@/ui/Icon';
import { PinGrid } from '@/ui/PinGrid';
import { radius, space, useTheme } from '@/ui/theme';

interface Picked {
  uri: string;
  width: number;
  height: number;
  raster: RasterImage;
  gray: Float32Array;
}

const STEP = 8;

export default function ImageScreen() {
  const t = useTheme();
  const { setPattern } = usePattern();
  const [picked, setPicked] = useState<Picked | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fit, setFit] = useState<FitMode>('fit');
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const [invert, setInvert] = useState(false);
  const [view, setView] = useState<'pins' | 'brightness'>('pins');

  const luminance = useMemo(
    () => (picked ? sampleCells(picked.gray, picked.raster.width, picked.raster.height, GRID.rows, GRID.cols, fit, GRID.pinPitchRatio) : null),
    [picked, fit],
  );
  const result = useMemo(
    () => (luminance ? patternFromLuminance(luminance, GRID.rows, GRID.cols, threshold, invert) : null),
    [luminance, threshold, invert],
  );

  const pick = async () => {
    setError(null);
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
      if (res.canceled || !res.assets?.length) return;
      const asset = res.assets[0];
      setLoading(true);
      const raster = await loadImagePixels(asset.uri, asset.width, asset.height);
      setPicked({ uri: asset.uri, width: asset.width, height: asset.height, raster, gray: toGrayscale(raster) });
      AccessibilityInfo.announceForAccessibility('Image converted to pin preview');
    } catch (e) {
      setError(`Could not read that image: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const use = () => {
    if (!result) return;
    setPattern(result, 'From image');
    router.navigate('/');
  };

  const gridAspect = (GRID.cols * GRID.pinPitchRatio) / GRID.rows;

  return (
    <Screen title="Image">
      {!picked ? (
        <Section padded style={{ maxWidth: 560, width: '100%', alignSelf: 'center' }}>
          <View style={styles.empty}>
            <View style={[styles.emptyIcon, { backgroundColor: t.tintSoft }]}>
              <Icon name="photo" color={t.tint} size={30} />
            </View>
            <Label variant="title3" style={{ textAlign: 'center' }}>
              Turn a picture into pins
            </Label>
            <Label variant="subhead" secondary style={{ textAlign: 'center' }}>
              Dark areas become raised pins. High-contrast images with simple shapes work best on a {GRID.rows} × {GRID.cols} grid.
            </Label>
          </View>
          <Button title="Choose Photo" icon="photo" onPress={pick} loading={loading} />
        </Section>
      ) : (
        <>
          <Columns
            rightWidth={420}
            left={
          <Section title="Original">
            <Image
              source={{ uri: picked.uri }}
              contentFit="contain"
              style={[styles.original, { aspectRatio: Math.max(0.5, Math.min(2.5, picked.width / picked.height)), backgroundColor: t.fill }]}
              accessibilityLabel="Selected image"
            />
            <View>
              <Label variant="footnote" secondary style={{ marginBottom: space.xs }}>
                What the pins sample ({fit === 'fit' ? 'whole image, padded' : 'centre, cropped'})
              </Label>
              <View style={[styles.frame, { aspectRatio: gridAspect, borderColor: t.separator, backgroundColor: '#FFFFFF' }]}>
                <Image source={{ uri: picked.uri }} contentFit={fit === 'fit' ? 'contain' : 'cover'} style={StyleSheet.absoluteFill} accessible={false} />
              </View>
            </View>
            <Button title="Choose Another Photo" variant="secondary" icon="photo" compact onPress={pick} loading={loading} />
          </Section>
            }
            right={
              <>
          <Section
            title="Conversion"
            footer={
              fit === 'fit'
                ? 'Fit keeps the whole image and fills the empty edges with lowered pins.'
                : 'Fill covers every pin and crops the image edges equally.'
            }>
            <SegmentedControl
              accessibilityLabel="Aspect ratio handling"
              value={fit}
              onChange={setFit}
              options={[
                { value: 'fit', label: 'Fit (pad)' },
                { value: 'fill', label: 'Fill (crop)' },
              ]}
            />
            <Separator />
            <View style={styles.sliderHeader}>
              <Label variant="body">Threshold</Label>
              <Label variant="body" secondary style={{ fontVariant: ['tabular-nums'] }}>
                {threshold}
              </Label>
            </View>
            <View style={styles.sliderRow}>
              <Button
                title=""
                accessibilityLabel="Decrease threshold"
                icon="minus"
                variant="secondary"
                compact
                style={styles.stepButton}
                onPress={() => setThreshold((v) => Math.max(0, v - STEP))}
              />
              <Slider
                style={{ flex: 1, height: 44 }}
                minimumValue={0}
                maximumValue={255}
                step={1}
                value={threshold}
                onValueChange={(v) => setThreshold(Math.round(v))}
                minimumTrackTintColor={t.tint}
                maximumTrackTintColor={t.fill}
                accessibilityLabel="Brightness threshold"
                accessibilityHint="Areas darker than this become raised pins"
                accessibilityValue={{ min: 0, max: 255, now: threshold }}
              />
              <Button
                title=""
                accessibilityLabel="Increase threshold"
                icon="plus"
                variant="secondary"
                compact
                style={styles.stepButton}
                onPress={() => setThreshold((v) => Math.min(255, v + STEP))}
              />
            </View>
            <Label variant="footnote" secondary>
              Higher raises more pins. Pixels darker than {threshold} of 255 are raised.
            </Label>
            <Separator />
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Label variant="body">Invert</Label>
                <Label variant="footnote" secondary>
                  Raise light areas instead of dark ones
                </Label>
              </View>
              <Switch value={invert} onValueChange={setInvert} accessibilityLabel="Invert, raise light areas instead of dark ones" />
            </View>
          </Section>

          {result && luminance ? (
            <Section title="Result">
              <SegmentedControl
                accessibilityLabel="Result view"
                value={view}
                onChange={setView}
                options={[
                  { value: 'pins', label: 'Pins' },
                  { value: 'brightness', label: 'Brightness' },
                ]}
              />
              {view === 'pins' ? <PinGrid pattern={result} /> : <BrightnessGrid luminance={luminance} threshold={threshold} />}
              <Label variant="footnote" secondary>
                {countRaised(result)} of {GRID.rows * GRID.cols} pins raised. You can correct individual pins on the Display tab.
              </Label>
              <Button title="Use This Pattern" icon="edit" onPress={use} accessibilityHint="Replaces the preview on the Display tab, where you can edit and send it." />
            </Section>
          ) : null}
              </>
            }
          />
        </>
      )}

      {error ? <StatusBanner tone="error" title="Image not converted" message={error} /> : null}
    </Screen>
  );
}

/** Average brightness per pin, so the threshold choice is easy to understand. */
function BrightnessGrid({ luminance, threshold }: { luminance: Float32Array; threshold: number }) {
  const t = useTheme();
  const [width, setWidth] = useState(0);
  const cell = width ? Math.min(64, Math.floor((width - 12) / GRID.cols)) : 0;
  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessible
      accessibilityLabel={`Brightness preview for each pin. Pins darker than ${threshold} are raised unless inverted.`}
      style={[styles.brightWell, { backgroundColor: t.gridWell }]}>
      {cell > 0 &&
        Array.from({ length: GRID.rows }, (_, r) => (
          <View key={r} style={{ flexDirection: 'row' }}>
            {Array.from({ length: GRID.cols }, (_, c) => {
              const v = Math.round(luminance[r * GRID.cols + c]);
              return (
                <View key={c} style={{ width: cell, height: cell, padding: 2 }}>
                  <View style={{ flex: 1, borderRadius: 4, backgroundColor: `rgb(${v},${v},${v})` }} />
                </View>
              );
            })}
          </View>
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', gap: space.sm, paddingVertical: space.lg },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: space.sm },
  original: { width: '100%', maxHeight: 440, borderRadius: radius.md },
  frame: { width: '100%', borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  sliderHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  sliderRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  stepButton: { width: 44, paddingHorizontal: 0 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 44 },
  brightWell: { borderRadius: radius.md, padding: 6, alignItems: 'center' },
});
