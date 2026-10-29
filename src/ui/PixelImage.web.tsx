import { useEffect, useRef } from 'react';

import type { RgbPixels } from './PixelImage';

/**
 * Browser version of PixelImage.tsx: the pixels are drawn straight onto a canvas. The preview changes on every live
 * camera frame, and turning each one into a PNG (then decoding it again to show it) kept the phone's main thread
 * busy and filled its memory with images seen once.
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
  const ref = useRef<HTMLCanvasElement>(null);
  /** Reused while the size stays the same (it usually does, frame after frame). */
  const buffer = useRef<ImageData | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const w = Math.max(1, pixels.width);
    const h = Math.max(1, pixels.height);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    let img = buffer.current;
    if (!img || img.width !== w || img.height !== h) {
      img = new ImageData(w, h);
      img.data.fill(255); // opaque
      buffer.current = img;
    }
    const out = img.data;
    const src = pixels.data;
    for (let p = 0, n = pixels.width * pixels.height; p < n; p++) {
      out[p * 4] = src[p * 3];
      out[p * 4 + 1] = src[p * 3 + 1];
      out[p * 4 + 2] = src[p * 3 + 2];
    }
    ctx.putImageData(img, 0, 0);
  }, [pixels]);

  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={accessibilityLabel}
      style={{ position: 'absolute', top: 0, left: 0, display: 'block', width: '100%', height: '100%', objectFit: fit }}
    />
  );
}
