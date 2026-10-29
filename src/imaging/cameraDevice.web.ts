/**
 * The browser camera: opening the back (or front) camera, preferring one that focuses by itself, and asking it to
 * keep focus and exposure adjusting, or to focus on a point (where the browser allows it). Used by
 * imageInput.web.ts's live capture.
 */
import type { CameraFacing } from './imageInput.web';

/** A readable message for a camera that couldn't start (or null when the user just said no to a picker). */
export function cameraError(e: unknown): Error {
  const name = e instanceof DOMException ? e.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return new Error('Camera access is blocked. Allow the camera for this site (the icon next to the address), then try again.');
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return new Error('No camera was found on this device.');
  if (name === 'NotReadableError' || name === 'AbortError')
    return new Error('The camera is busy. Close other apps or tabs using it, then try again.');
  return e instanceof Error ? e : new Error(String(e));
}

/** The camera controls this file uses. Chrome on Android reports them; iPhones and most laptops don't (they focus by themselves). */
interface FocusCapabilities {
  focusMode?: string[];
  exposureMode?: string[];
  whiteBalanceMode?: string[];
}
export const capabilitiesOf = (track: MediaStreamTrack | undefined) => (track?.getCapabilities?.() ?? {}) as FocusCapabilities;

/** The camera can focus by itself, or doesn't say (then it is trusted: iPhones focus on their own). */
export const autofocuses = (stream: MediaStream) => {
  const modes = capabilitiesOf(stream.getVideoTracks()[0]).focusMode;
  return !modes || modes.includes('continuous') || modes.includes('single-shot');
};

/** The back camera that focused well, remembered so the search below happens once per phone. */
const CAMERA_KEY = 'pinvisual.camera.environment';
const remembered = () => {
  try {
    return localStorage.getItem(CAMERA_KEY);
  } catch {
    return null;
  }
};
const remember = (id: string | undefined) => {
  try {
    if (id) localStorage.setItem(CAMERA_KEY, id);
  } catch {
    // Private mode or blocked storage: the search just runs again next time.
  }
};

// 1280 x 720 is plenty (frames are shrunk to 640, captures to 800, a screen or page in view is read at up to 1600)
// and every phone camera offers it. 24 frames a second: the analysis takes 4 a second at most, and fewer frames to
// capture and show keeps the phone cooler (it slows itself down once warm).
const SIZE: MediaTrackConstraints = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24 } };
const getCamera = (video: MediaTrackConstraints) => navigator.mediaDevices.getUserMedia({ video: { ...SIZE, ...video }, audio: false });
export const stopStream = (s: MediaStream) => s.getTracks().forEach((t) => t.stop());

/**
 * Opens a camera that can focus. Phones with several back cameras (wide, ultra-wide, telephoto, depth) often hand
 * Chrome one that is fixed-focus, so close-up pictures stay blurry whatever happens. When the browser's choice
 * says it can't autofocus, the other back cameras are tried one at a time (phones can't open two at once) and
 * the first that can is used, and remembered.
 */
export async function openCamera(facing: CameraFacing): Promise<MediaStream> {
  if (facing === 'environment') {
    const saved = remembered();
    if (saved) {
      const s = await getCamera({ deviceId: { exact: saved } }).catch(() => null);
      if (s && autofocuses(s)) return s;
      if (s) stopStream(s);
    }
  }
  let stream: MediaStream;
  try {
    stream = await getCamera({ facingMode: { ideal: facing } });
  } catch (e) {
    // Some laptops reject the size or facing hints: any camera will do.
    if (e instanceof DOMException && e.name === 'OverconstrainedError') return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    throw e;
  }
  const current = stream.getVideoTracks()[0]?.getSettings().deviceId;
  if (facing !== 'environment' || autofocuses(stream)) {
    if (facing === 'environment' && capabilitiesOf(stream.getVideoTracks()[0]).focusMode) remember(current);
    return stream;
  }
  // Device labels (e.g. "camera2 2, facing back") are only filled in once the camera is allowed, which it now is.
  const others = (await navigator.mediaDevices.enumerateDevices())
    .filter((d) => d.kind === 'videoinput' && d.deviceId !== current && (!d.label || /back|rear|environment/i.test(d.label)));
  stopStream(stream);
  for (const d of others) {
    const s = await getCamera({ deviceId: { exact: d.deviceId } }).catch(() => null);
    if (!s) continue;
    const track = s.getVideoTracks()[0];
    const back = !track?.getSettings().facingMode || track.getSettings().facingMode === 'environment';
    if (back && autofocuses(s)) {
      remember(d.deviceId);
      return s;
    }
    stopStream(s);
  }
  // None focuses better: back to the browser's choice.
  return getCamera({ facingMode: { ideal: facing } });
}

/** Camera controls (focus, points of interest) are in the Image Capture spec, not yet in TypeScript's DOM types. */
export const extra = (set: Record<string, unknown>) => set as unknown as MediaTrackConstraintSet;

/** Lets the camera keep focus, exposure and colour adjusting by themselves, where the browser allows it. */
export async function tuneCamera(stream: MediaStream) {
  const track = stream.getVideoTracks()[0];
  const caps = capabilitiesOf(track);
  const set: Record<string, string> = {};
  if (caps.focusMode?.includes('continuous')) set.focusMode = 'continuous';
  if (caps.exposureMode?.includes('continuous')) set.exposureMode = 'continuous';
  if (caps.whiteBalanceMode?.includes('continuous')) set.whiteBalanceMode = 'continuous';
  if (Object.keys(set).length) await track.applyConstraints({ advanced: [extra(set)] }).catch(() => {});
}

/**
 * Focuses (and meters exposure) on a point of the picture, 0..1 across and down: a single focus sweep there,
 * then back to continuous focus around the same point. Chrome on Android; elsewhere it does nothing and returns
 * false (iPhones focus on their own).
 */
export async function focusCameraAt(stream: MediaStream, x: number, y: number): Promise<boolean> {
  const track = stream.getVideoTracks()[0];
  if (!track) return false;
  const caps = capabilitiesOf(track);
  const supported = navigator.mediaDevices.getSupportedConstraints() as Record<string, boolean>;
  const point = { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
  const where = supported.pointsOfInterest ? { pointsOfInterest: [point] } : {};
  const sweep = caps.focusMode?.includes('single-shot') ? 'single-shot' : caps.focusMode?.includes('continuous') ? 'continuous' : null;
  if (!sweep) return false;
  try {
    await track.applyConstraints({ advanced: [extra({ ...where, focusMode: sweep })] });
  } catch {
    return false;
  }
  if (sweep === 'single-shot' && caps.focusMode?.includes('continuous'))
    setTimeout(() => {
      if (track.readyState === 'live')
        track.applyConstraints({ advanced: [extra({ ...where, focusMode: 'continuous' })] }).catch(() => {});
    }, 1500);
  return true;
}

