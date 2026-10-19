/**
 * Reading graph axis numbers on iOS and Android: not available yet (the web version uses Tesseract.js, see
 * axisNumbers.web.ts). Graph windows then count one major grid square as one unit.
 */
import type { Rect } from './geometry';
import type { AxisReading } from './graph';

export const axisNumbersAvailable = false;

export interface AxisNumberSource {
  uri?: string;
  video?: unknown;
}

export async function readAxisNumbers(
  _source: AxisNumberSource,
  _workingWidth: number,
  _bands: { axis: 'x' | 'y'; rect: Rect }[],
): Promise<AxisReading[]> {
  return [];
}
