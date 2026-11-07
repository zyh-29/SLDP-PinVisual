import { StyleSheet, View } from 'react-native';

import type { LiveCapture } from '@/imaging/imageInput';
import { Button, StatusBanner } from './components';
import { CAMERA_HINT, SCREEN_HINT } from './ImageSourcePicker';
import { space } from './theme';

interface Props {
  /** The screen share or camera running, if any. */
  live: Pick<LiveCapture, 'kind' | 'shared' | 'canFlip' | 'facing'> | null;
  /** Live camera: the picture is essentially black. */
  dark: boolean;
  /** Live camera focus: 0 sharp, 1 refocusing, 2 can't get sharp. */
  focusTrouble: 0 | 1 | 2;
  loading: boolean;
  /** The user cropped or tapped, so Auto Crop has something to undo. */
  canAutoCrop: boolean;
  onAutoCrop: () => void;
  /** While live: frame the whole camera view or shared screen. */
  onWholeView: () => void;
  onClear: () => void;
  onCapture: () => void;
  onStopLive: () => void;
  onFlip: () => void;
  onPick: () => void;
  /** Absent when this device has no camera the app can use. */
  onCamera?: () => void;
  /** Absent when this device can't share its screen. */
  onScreen?: () => void;
}

/** The warnings and buttons under the crop view on the Image tab. */
export function ImageCropControls({
  live,
  dark,
  focusTrouble,
  loading,
  canAutoCrop,
  onAutoCrop,
  onWholeView,
  onClear,
  onCapture,
  onStopLive,
  onFlip,
  onPick,
  onCamera,
  onScreen,
}: Props) {
  const camera = live?.kind === 'camera';
  return (
    <>
      {camera && dark ? (
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
      ) : camera && focusTrouble === 2 ? (
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
          style={styles.tool}
          disabled={!canAutoCrop}
          onPress={onAutoCrop}
          accessibilityHint="Crops to the main subject again"
        />
        {live ? (
          // While live, Stop (below) already ends it; this slot frames the whole picture.
          <Button
            title={camera ? 'Whole View' : 'Whole Screen'}
            icon="fullscreen"
            variant="secondary"
            compact
            style={styles.tool}
            onPress={onWholeView}
            accessibilityHint={`Uses the whole ${camera ? 'camera view' : 'shared screen'} instead of the automatic crop`}
          />
        ) : (
          <Button
            title="Clear Image"
            icon="close"
            variant="destructive"
            compact
            style={styles.tool}
            onPress={onClear}
            accessibilityHint="Removes the image and returns to the start"
          />
        )}
      </View>
      {camera ? (
        <>
          <View style={styles.buttonRow}>
            <Button
              title="Capture"
              icon="camera"
              compact
              style={styles.tool}
              onPress={onCapture}
              loading={loading}
              accessibilityLabel="Capture photo"
              accessibilityHint="Takes a photo of what the camera sees and turns the camera off"
            />
            <Button
              title="Stop Camera"
              variant="destructive"
              icon="stop"
              compact
              style={styles.tool}
              onPress={onStopLive}
              accessibilityHint="Turns the camera off and keeps the last picture"
            />
          </View>
          {live.canFlip ? (
            <Button
              title="Flip Camera"
              variant="secondary"
              icon="flip"
              compact
              onPress={onFlip}
              accessibilityHint={`Switches to the ${live.facing === 'user' ? 'back' : 'front'} camera`}
            />
          ) : null}
        </>
      ) : (
        <View style={styles.buttonRow}>
          <Button
            title={onCamera || onScreen ? 'New Photo' : 'Choose Another Photo'}
            variant="secondary"
            icon="photo"
            compact
            style={styles.tool}
            onPress={onPick}
            loading={loading}
          />
          {live ? (
            <Button title="Stop Sharing" variant="destructive" icon="stop" compact style={styles.tool} onPress={onStopLive} />
          ) : (
            <>
              {onCamera ? (
                <Button
                  title="Camera"
                  variant="secondary"
                  icon="camera"
                  compact
                  style={styles.tool}
                  onPress={onCamera}
                  disabled={loading}
                  accessibilityLabel="Live camera"
                  accessibilityHint={CAMERA_HINT}
                />
              ) : null}
              {onScreen ? (
                <Button
                  title="Screen"
                  accessibilityLabel="Share screen"
                  variant="secondary"
                  icon="screen"
                  compact
                  style={styles.tool}
                  onPress={onScreen}
                  disabled={loading}
                  accessibilityHint={SCREEN_HINT}
                />
              ) : null}
            </>
          )}
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  // Equal widths, but never so narrow a label is cut off: they wrap to another line instead.
  tool: { flexGrow: 1, flexBasis: 120 },
});
