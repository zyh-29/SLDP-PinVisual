import { useEffect, useRef } from 'react';

/** Plays a shared-screen stream (web only). Fills its parent; the crop box is drawn on top. */
export function LiveVideo({ stream }: { stream: unknown }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.srcObject = stream as MediaStream;
    v.play().catch(() => {});
    return () => {
      v.srcObject = null;
    };
  }, [stream]);
  return (
    <video
      ref={ref}
      muted
      playsInline
      autoPlay
      style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'fill', pointerEvents: 'none' }}
    />
  );
}
