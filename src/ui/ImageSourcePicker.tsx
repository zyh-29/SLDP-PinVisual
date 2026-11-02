import { View } from 'react-native';

import { Row, Section, Separator } from './components';
import { EquationInput } from './EquationInput';
import { space } from './theme';

export const CAMERA_HINT = 'Turns on the camera. Once it locks onto something the pins hold still on it; tap another thing to switch.';
export const SCREEN_HINT = 'Share the window with your graph or shape (not the entire screen, where PinVisual sees itself). The pins follow it live; crop the part you want.';

/** Text column width for this page before there's a picture: lists read best at about this width. */
export const PICKER_WIDTH = 680;

/** The Image tab before there is a picture: where it can come from, as an inset grouped list. */
export function ImageSourcePicker({
  loading,
  onPick,
  onCamera,
  onScreen,
  dropHint,
  onEquation,
  equationError,
}: {
  loading: boolean;
  onPick: () => void;
  /** Only where a live camera works. */
  onCamera?: () => void;
  /** Only where screen sharing works. */
  onScreen?: () => void;
  /** Mention dropping an image (web). */
  dropHint: boolean;
  onEquation: (text: string) => void;
  equationError: string | null;
}) {
  return (
    <View style={{ gap: space.xl }}>
      <Section
        title="Picture"
        padded={false}
        footer="A clear shape or graph on a plain background works best. Tap the picture afterwards to pick what the pins show.">
        <Row
          icon="photo"
          title="Choose Photo"
          detail={dropHint ? 'From your files, or drop an image on this page' : 'From your photo library'}
          chevron
          loading={loading}
          onPress={onPick}
        />
        {onCamera ? (
          <>
            <Separator inset={62} />
            <Row
              icon="camera"
              title="Live Camera"
              detail="Point it at a shape, graph or object"
              chevron
              disabled={loading}
              onPress={onCamera}
              accessibilityHint={CAMERA_HINT}
            />
          </>
        ) : null}
        {onScreen ? (
          <>
            <Separator inset={62} />
            <Row
              icon="screen"
              title="Share Screen"
              detail="Follow a window with a graph or shape"
              chevron
              disabled={loading}
              onPress={onScreen}
              accessibilityHint={SCREEN_HINT}
            />
          </>
        ) : null}
      </Section>
      <Section title="Equation" padded={false} footer="Draws its graph on the pins. For example sin(x), 1/x or y = x^2 - 3.">
        <EquationInput row onDraw={onEquation} error={equationError} />
      </Section>
    </View>
  );
}
