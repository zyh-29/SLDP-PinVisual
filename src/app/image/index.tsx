import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { toRgb } from '@/imaging/foreground';
import { fullRect, type Rect } from '@/imaging/geometry';
import { parseEquation, renderEquation } from '@/imaging/equation';
import { renderCrop } from '@/imaging/pinSampling';
import { rgbToPngDataUri } from '@/imaging/previewPng';
import type { Focus } from '@/imaging/smartCrop';
import { usePattern } from '@/state/PatternProvider';
import { useBoardActions } from '@/state/useBoardActions';
import { NO_PAN, useConversionSettings } from '@/state/useConversionSettings';
import { type PickedImage, useImageConversion } from '@/state/useImageConversion';
import { usePinEdits } from '@/state/usePinEdits';
import { Columns, Screen, Section } from '@/ui/components';
import { ConversionSettings } from '@/ui/ConversionSettings';
import { CropEditor } from '@/ui/CropEditor';
import { ImageCropControls } from '@/ui/ImageCropControls';
import { ImageSourcePicker, PICKER_WIDTH } from '@/ui/ImageSourcePicker';
import { ImageResult } from '@/ui/ImageResult';
import { PinsSeePreview } from '@/ui/PinsSeePreview';
import { SavePatternSheet } from '@/ui/SavePatternSheet';
import { VoiceBar, VoiceToggle } from '@/ui/VoicePanel';
import { announce } from '@/voice/announce';
import { useImageTabVoice } from '@/voice/useImageTabVoice';
import { useVoice } from '@/voice/VoiceProvider';

/** The Image tab: a typed (or spoken) equation drawn as a graph, then turned into pins. */
export default function ImageScreen() {
  const { setPattern } = usePattern();
  const [picked, setPicked] = useState<PickedImage | null>(null);
  const prefs = useConversionSettings();
  const { removeBackground, removeClutter, toleranceOverride, sensitivity, snap, linesOverride, graphRange, graphPan, thinLines } = prefs.settings;

  /** null = automatic (smart crop). */
  const [manualCrop, setManualCrop] = useState<Rect | null>(null);
  /** A point the user tapped on the graph: the smart crop focuses on what's there (e.g. one of several curves). */
  const [focus, setFocus] = useState<Focus | null>(null);
  const [dragging, setDragging] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);

  const c = useImageConversion(picked, {
    removeBackground,
    removeClutter,
    toleranceOverride,
    pinFill: (100 - sensitivity) / 100,
    snap,
    manualCrop,
    focus,
    linesOverride,
    graphRange,
    graphPan,
    thinLines,
  });
  const { fg, result } = c;

  // Pin lock: the user's pin edits, tied to the graph they were made on.
  const pins = usePinEdits(picked, result);
  const { shown } = pins;

  const resetForNewImage = () => {
    setManualCrop(null);
    setFocus(null);
    prefs.resetForNewPicture();
    pins.clear();
  };

  /** A typed equation: drawn as a plot with a known scale, then turned into pins. */
  const [equationError, setEquationError] = useState<string | null>(null);
  /** Null when drawn, else why not. `quiet`: voice says what was drawn itself, in words. */
  const drawEquation = (text: string, quiet = false): string | null => {
    try {
      const { raster, scale } = renderEquation(parseEquation(text));
      const rgb = toRgb(raster);
      setEquationError(null);
      const uri = rgbToPngDataUri(renderCrop(rgb, raster.width, raster.height, null, fullRect(raster.width, raster.height)));
      setPicked({ uri, raster, rgb, equation: { text, scale } });
      resetForNewImage();
      if (!quiet) announce(`Drew ${text}`);
      return null;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setEquationError(message);
      return message;
    }
  };

  /** Back to the empty Image tab: forgets the graph, crop and per-graph settings. */
  const clearImage = () => {
    setPicked(null);
    resetForNewImage();
    announce('Graph cleared');
  };

  const board = useBoardActions();
  /** Sends the result, and makes it the preview so the Display tab shows what the board has. */
  const sendResult = () => {
    if (!shown) return;
    setPattern(shown, 'From graph');
    void board.sendPattern(shown);
  };

  /** Makes the result the preview and opens the Display tab. */
  const takeResult = () => {
    if (!shown) return;
    setPattern(shown, 'From graph');
    router.navigate('/');
  };

  const voice = useVoice();
  useImageTabVoice({
    hasPicture: !!picked,
    shown,
    autoTolerance: fg?.tolerance,
    prefs,
    clearImage,
    usePattern: takeResult,
    drawEquation,
    send: sendResult,
  });

  return (
    <View style={styles.screen}>
      <Screen
        title="Image"
        // Native: hold the scroll view still while the crop box is dragged. Web: never toggle it, because hiding the
        // page scrollbar changes the content width and makes the whole picture jump; the crop area blocks touch scrolling itself.
        scrollEnabled={Platform.OS === 'web' || !dragging}
        // iPhone: VoiceOver's two-finger double-tap starts or stops listening.
        headerRight={<VoiceToggle />}
        // Before there's a graph the page is one list column: the header lines up with it.
        width={!picked || !fg ? PICKER_WIDTH : undefined}
        onMagicTap={voice.openAndListen}>
        <VoiceBar />
        {!picked || !fg ? (
          <ImageSourcePicker onEquation={drawEquation} equationError={equationError} />
        ) : (
          <Columns
            rightWidth={420}
            left={
              <>
                <Section title="Crop">
                  <CropEditor
                    uri={picked.uri}
                    imageWidth={picked.raster.width}
                    imageHeight={picked.raster.height}
                    crop={c.crop}
                    onChange={setManualCrop}
                    focus={manualCrop || !focus ? null : focus}
                    onTap={(point) => {
                      // Tap a curve: the smart crop focuses on it (your own box gives way to it).
                      setManualCrop(null);
                      setFocus({ ...point, tap: true });
                      prefs.set('graphPan', NO_PAN);
                      announce('Cropped to what you tapped');
                    }}
                    onDragging={setDragging}
                  />
                  <ImageCropControls
                    canAutoCrop={!!manualCrop || !!focus}
                    onAutoCrop={() => {
                      setManualCrop(null);
                      setFocus(null);
                    }}
                    onClear={clearImage}
                  />
                </Section>

                <PinsSeePreview pixels={c.cleaned} stretch={c.stretch} />
              </>
            }
            right={
              <>
                <ConversionSettings
                  settings={prefs.settings}
                  set={prefs.set}
                  conversion={c}
                  equation={picked.equation?.text ?? null}
                  onEquation={drawEquation}
                  equationError={equationError}
                />

                {shown ? (
                  <ImageResult
                    pattern={shown}
                    unlocked={pins.unlocked}
                    edited={pins.edited}
                    onToggleLock={pins.toggleLock}
                    onTogglePin={pins.togglePinAt}
                    onReset={pins.resetPins}
                    onUse={takeResult}
                    onSave={() => setSaveOpen(true)}
                    board={{ connected: board.connected, command: board.state.command, onSend: sendResult, onClear: () => void board.lowerPins(false) }}
                  />
                ) : null}
              </>
            }
          />
        )}
      </Screen>
      {shown ? (
        <SavePatternSheet
          visible={saveOpen}
          pattern={shown}
          onClose={() => setSaveOpen(false)}
          onSaved={(name) => {
            setSaveOpen(false);
            announce(`Saved ${name}`);
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, flexBasis: 120 },
});
