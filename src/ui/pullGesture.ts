/**
 * The maths for pull-to-refresh on the website, kept apart from the browser code so it can be unit tested.
 */

/** How far (points) the indicator travels at most, and how far it must be pulled to reload. */
export const PULL_MAX = 120;
export const PULL_TRIGGER = 72;
/** A pull this short isn't decided yet (a tap, or a scroll in some direction). */
export const PULL_SLOP = 8;

/** The finger moved `dy` down: the indicator follows less and less (rubber band), never past PULL_MAX. */
export const resist = (dy: number) => (dy <= 0 ? 0 : PULL_MAX * (1 - Math.exp(-dy / (PULL_MAX * 1.6))));

/**
 * Once the finger has moved past PULL_SLOP: is it a pull to refresh? Only down, mostly vertical, and with the page
 * already at its top (otherwise it's a normal scroll up the page).
 */
export function isPull(dx: number, dy: number, scrollTop: number): boolean {
  return scrollTop <= 0 && dy > 0 && dy > Math.abs(dx) * 1.2;
}
