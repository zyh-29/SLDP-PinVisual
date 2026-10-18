/**
 * Browser version of loadImage.ts: draws the picked image onto a canvas
 * (downscaled to WORKING_SIZE) and reads its RGBA pixels directly.
 * The conversion math in convert.ts is shared with the mobile app.
 */
import type { RasterImage } from './convert';

const WORKING_SIZE = 800;

function loadHtmlImage(uri: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The browser could not decode this image.'));
    img.src = uri;
  });
}

export async function loadImagePixels(uri: string, _width?: number, _height?: number): Promise<RasterImage & { fileUri?: string }> {
  const img = await loadHtmlImage(uri);
  const w0 = img.naturalWidth;
  const h0 = img.naturalHeight;
  if (!w0 || !h0) throw new Error('Image is empty');
  const scale = Math.min(1, WORKING_SIZE / Math.max(w0, h0));
  const width = Math.max(1, Math.round(w0 * scale));
  const height = Math.max(1, Math.round(h0 * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas is not available in this browser.');
  ctx.imageSmoothingQuality = 'high';
  // Transparent areas stay transparent; toGrayscale composites them over white.
  ctx.drawImage(img, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  return { width, height, data, channels: 4 };
}
