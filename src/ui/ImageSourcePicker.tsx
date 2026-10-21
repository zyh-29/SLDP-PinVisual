import { StyleSheet, View } from 'react-native';

import { Button, Label, Section, Separator } from './components';
import { EquationInput } from './EquationInput';
import { Icon } from './Icon';
import { space, useTheme } from './theme';

export const CAMERA_HINT = 'Turns on the camera. Once it locks onto something the pins hold still on it; tap another thing to switch.';
export const SCREEN_HINT = 'Share a screen or window. The pins follow it live; crop the part you want.';

/** The Image tab before there is a picture: where it can come from. */
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
  /** Show "or drop an image here" (web). */
  dropHint: boolean;
  onEquation: (text: string) => void;
  equationError: string | null;
}) {
  const t = useTheme();
  return (
    <Section padded style={{ maxWidth: 560, width: '100%', alignSelf: 'center' }}>
      <View style={styles.empty}>
        <View style={[styles.emptyIcon, { backgroundColor: t.tintSoft }]}>
          <Icon name="photo" color={t.tint} size={30} />
        </View>
        <Label variant="title3" style={{ textAlign: 'center' }}>
          Turn a picture into pins
        </Label>
      </View>
      <Button title="Choose Photo" icon="photo" onPress={onPick} loading={loading} />
      {onCamera ? (
        <Button title="Live Camera" icon="camera" variant="secondary" onPress={onCamera} disabled={loading} accessibilityHint={CAMERA_HINT} />
      ) : null}
      {onScreen ? (
        <Button title="Share Screen" icon="screen" variant="secondary" onPress={onScreen} disabled={loading} accessibilityHint={SCREEN_HINT} />
      ) : null}
      {dropHint ? (
        <Label variant="footnote" secondary style={{ textAlign: 'center' }}>
          or drop an image here
        </Label>
      ) : null}
      <Separator />
      <Label variant="headline">Or type an equation</Label>
      <EquationInput onDraw={onEquation} error={equationError} />
    </Section>
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
});
