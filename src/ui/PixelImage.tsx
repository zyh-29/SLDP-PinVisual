import { Image } from 'expo-image';
import { useMemo } from 'react';
import { StyleSheet } from 'react-native';

import { rgbToPngDataUri } from '@/imaging/previewPng';

export interface RgbPixels {
  width: number;
  height: number;
  /** 8-bit RGB, 3 channels. */
  data: Uint8Array;
}

/**
 * Shows raw RGB pixels (the "What the pins see" preview), filling its parent. On phones they go through a PNG,
 * which <Image> can show; the browser version draws them straight onto a canvas.
 */
export function PixelImage({
  pixels,
  fit,
  accessibilityLabel,
}: {
  pixels: RgbPixels;
  fit: 'fill' | 'contain';
  accessibilityLabel?: string;
}) {
  const uri = useMemo(() => rgbToPngDataUri(pixels), [pixels]);
  return <Image source={{ uri }} contentFit={fit} style={StyleSheet.absoluteFill} accessibilityLabel={accessibilityLabel} />;
}
