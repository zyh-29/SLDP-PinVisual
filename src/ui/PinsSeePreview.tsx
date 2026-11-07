import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';

import { GRID } from '@/config/hardware';
import { Section, StatusBanner } from './components';
import { PixelImage } from './PixelImage';
import { radius, useTheme } from './theme';

interface Props {
  /** The cropped, cleaned picture the pins are sampled from. */
  pixels: ComponentProps<typeof PixelImage>['pixels'] | null;
  /** Stretch to the grid's shape instead of fitting inside it. */
  stretch: boolean;
  removeBackground: boolean;
  cuttingOut: boolean;
  cutoutError?: string | null;
  cutoutOn: boolean;
  /** Background removal found nothing to keep. */
  noSubject: boolean;
  landscape: boolean;
}

/** The "What the pins see" section of the Image tab: the picture as the pins sample it, and what happened to it. */
export function PinsSeePreview({ pixels, stretch, removeBackground, cuttingOut, cutoutError, cutoutOn, noSubject, landscape }: Props) {
  const t = useTheme();
  const gridAspect = (GRID.cols * GRID.pinPitchRatio) / GRID.rows;
  return (
    <Section title="What the pins see">
      <View style={[styles.frame, { aspectRatio: gridAspect, borderColor: t.separator }]}>
        {pixels ? (
          <PixelImage
            pixels={pixels}
            fit={stretch ? 'fill' : 'contain'}
            accessibilityLabel={removeBackground ? 'Cropped image with the background removed' : 'Cropped image'}
          />
        ) : null}
      </View>
      {cuttingOut ? (
        <StatusBanner tone="progress" title="Cutting out subject…" />
      ) : cutoutError ? (
        <StatusBanner tone="warning" title="Smart Cut-Out unavailable" message={cutoutError} />
      ) : noSubject ? (
        <StatusBanner tone="warning" title="No subject found" message={cutoutOn ? undefined : 'Try a lower Tolerance.'} />
      ) : landscape ? (
        <StatusBanner
          tone="neutral"
          title="Landscape"
          message="The pins show the skyline: the land raised, the sky lowered. Tap something in the picture to show just that."
        />
      ) : null}
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
