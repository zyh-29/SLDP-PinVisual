import { useEffect, useRef } from 'react';

/**
 * Shows the shared screen behind the crop box (web only). It places the
 * capture's own <video> element here instead of creating a second one, so
 * the picture appears at once: a shared window sends new frames only when
 * something on it changes, and a second element would wait for that.
 */
export function LiveVideo({ video }: { video: unknown }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = video as HTMLVideoElement;
    const div = host.current;
    if (!div || !el) return;
    div.appendChild(el);
    el.play().catch(() => {});
    return () => {
      el.remove();
      // Taking a media element out of the page pauses it; keep it running so processing continues.
      el.play().catch(() => {});
    };
  }, [video]);
  return <div ref={host} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />;
}
