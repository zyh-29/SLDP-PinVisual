/**
 * Web only: engines served by the app itself from public/ (ONNX Runtime for Smart Cut-Out, Tesseract.js for
 * axis numbers), loaded as plain scripts on first use. Imported only by .web.ts files.
 */

/**
 * Where the app is hosted: '' at a site's root, or e.g. '/pinvisual' in a folder (set with WEB_BASE_URL when
 * building, see app.config.js). Files in public/ need it in their URLs.
 */
export const APP_BASE = (process.env.EXPO_BASE_URL ?? '').replace(/\/$/, '');

/** Adds a script tag and waits for it. `what` names it in the error. */
export function loadScript(src: string, what: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Could not load the ${what}`));
    document.head.appendChild(s);
  });
}
