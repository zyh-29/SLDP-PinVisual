import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';

import { GRID } from '@/config/hardware';
import { Section } from './components';
import { PixelImage } from './PixelImage';
import { radius, useTheme } from './theme';

interface Props {
  /** The cropped, cleaned picture the pins are sampled from. */
  pixels: ComponentProps<typeof PixelImage>['pixels'] | null;
  /** Stretch to the grid's shape instead of fitting inside it. */
  stretch: boolean;
}

/** The "What the pins see" section of the Image tab: the graph as the pins sample it. */
export function PinsSeePreview({ pixels, stretch }: Props) {
  const t = useTheme();
  const gridAspect = (GRID.cols * GRID.pinPitchRatio) / GRID.rows;
  return (
    <Section title="What the pins see">
      <View style={[styles.frame, { aspectRatio: gridAspect, borderColor: t.separator }]}>
        {pixels ? (
          <PixelImage
            pixels={pixels}
            fit={stretch ? 'fill' : 'contain'}
            accessibilityLabel="Cropped graph"
          />
        ) : null}
      </View>
    </Section>
  );
}

const styles = StyleSheet.create({
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
