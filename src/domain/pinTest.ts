import { DIRECT_SERVO, GRID } from '@/config/hardware';
import { createEmptyPattern, getPin, type Pattern, pinPosition, servoForPin } from './pattern';

/** Pins are numbered 1 to rows × cols, left to right, top row first (pin 1 is the top-left one). */
export const PIN_COUNT = GRID.rows * GRID.cols;

/** The pin the Pin Test tab moves (1-based): the one whose servo is plugged straight into the ESP32. */
export const TEST_PIN = DIRECT_SERVO.pinIndex + 1;

/** The pattern the Pin Test tab sends: only `pin` (1-based) raised, or every pin lowered. */
export function singlePin(pin: number, raised: boolean): Pattern {
  const p = createEmptyPattern(GRID.rows, GRID.cols);
  if (!raised) return p;
  const cells = p.cells.slice();
  cells[pin - 1] = 1;
  return { ...p, cells };
}

/**
 * Where pin `pin` (1-based) sits, and how its servo is wired: straight to an ESP32 GPIO (`gpio`), else through a
 * servo board (`servo`, see servoForPin).
 */
export function pinInfo(pin: number) {
  const { row, col } = pinPosition(pin - 1, GRID.cols);
  const gpio = pin - 1 === DIRECT_SERVO.pinIndex ? DIRECT_SERVO.gpio : null;
  return { row: row + 1, col: col + 1, gpio, servo: servoForPin(pin - 1) };
}

/** Whether `pin` (1-based) is raised in a pattern the board acknowledged (null: nothing acknowledged yet). */
export function pinRaisedIn(p: Pattern | null, pin: number): boolean {
  if (!p || p.rows !== GRID.rows || p.cols !== GRID.cols) return false;
  const { row, col } = pinPosition(pin - 1, GRID.cols);
  return getPin(p, row, col) === 1;
}
