/**
 * The website's way to tell a screen reader something: text put into a hidden "live region", which screen readers
 * (VoiceOver, NVDA, JAWS, TalkBack) read out as it changes. React Native Web's announceForAccessibility does
 * nothing, so without this none of the app's announcements reached screen readers on the web.
 */
let region: HTMLElement | null = null;
let clearTimer: ReturnType<typeof setTimeout> | undefined;

function getRegion(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  if (region?.isConnected) return region;
  region = document.createElement('div');
  region.setAttribute('role', 'status');
  region.setAttribute('aria-live', 'polite');
  region.setAttribute('aria-atomic', 'true');
  region.id = 'pinvisual-announcer';
  // Hidden from sight but not from screen readers.
  Object.assign(region.style, {
    position: 'absolute',
    width: '1px',
    height: '1px',
    margin: '-1px',
    padding: '0',
    overflow: 'hidden',
    clip: 'rect(0 0 0 0)',
    whiteSpace: 'nowrap',
    border: '0',
  });
  document.body.appendChild(region);
  return region;
}

export function liveAnnounce(text: string) {
  const el = getRegion();
  if (!el) return;
  // Emptied first, so the same message said twice in a row is read twice.
  el.textContent = '';
  clearTimeout(clearTimer);
  setTimeout(() => {
    el.textContent = text;
    // Cleared afterwards, so a screen reader moving through the page later doesn't find stale messages.
    clearTimer = setTimeout(() => {
      if (el.textContent === text) el.textContent = '';
    }, 8000);
  }, 60);
}
