import { StyleSheet, View } from 'react-native';

import { Button } from './components';
import { space } from './theme';

interface Props {
  /** The user cropped or tapped, so Auto Crop has something to undo. */
  canAutoCrop: boolean;
  onAutoCrop: () => void;
  onClear: () => void;
}

/** The buttons under the crop view on the Image tab. */
export function ImageCropControls({ canAutoCrop, onAutoCrop, onClear }: Props) {
  return (
    <View style={styles.buttonRow}>
      <Button
        title="Auto Crop"
        icon="sparkles"
        variant="secondary"
        compact
        style={styles.tool}
        disabled={!canAutoCrop}
        onPress={onAutoCrop}
        accessibilityHint="Crops to the curve again"
      />
      <Button
        title="Clear Graph"
        icon="close"
        variant="destructive"
        compact
        style={styles.tool}
        onPress={onClear}
        accessibilityHint="Removes the graph and returns to the start"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  // Equal widths, but never so narrow a label is cut off: they wrap to another line instead.
  tool: { flexGrow: 1, flexBasis: 120 },
});
