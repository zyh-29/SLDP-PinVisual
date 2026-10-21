/** Small statistics helpers shared by the imaging code. Pure functions, unit tested. */

/**
 * The middle value (the upper one of the two for an even count), by quickselect: no full sort, which matters on
 * every live camera frame. `ifEmpty` for an empty list.
 */
export function median(values: ArrayLike<number>, ifEmpty = NaN): number {
  if (!values.length) return ifEmpty;
  // Quickselect: the middle value without sorting everything (this runs on every live camera frame).
  const a = Float64Array.from(values);
  const k = a.length >> 1;
  let lo = 0;
  let hi = a.length - 1;
  while (lo < hi) {
    const pivot = a[(lo + hi) >> 1];
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (a[i] < pivot) i++;
      while (a[j] > pivot) j--;
      if (i <= j) {
        const t = a[i];
        a[i] = a[j];
        a[j] = t;
        i++;
        j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else break;
  }
  return a[k];
}
