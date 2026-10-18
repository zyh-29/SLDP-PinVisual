import { encode } from 'fast-png';

import { bytesToBase64 } from '@/protocol/base64';

/** Encodes 8-bit RGB pixels as a PNG data URI, so a processed image can be shown with <Image>. */
export function rgbToPngDataUri(img: { width: number; height: number; data: Uint8Array }): string {
  const bytes = encode({ width: img.width, height: img.height, data: img.data, channels: 3, depth: 8 });
  return `data:image/png;base64,${bytesToBase64(bytes)}`;
}
