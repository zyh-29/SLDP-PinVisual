import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

/**
 * A captured or dropped photo (a blob: address) stays in the browser's memory until released: releases each one
 * once another picture has replaced it.
 */
export function useReleaseBlobUri(uri: string | undefined) {
  const shown = useRef<string | undefined>(undefined);
  useEffect(() => {
    const before = shown.current;
    shown.current = uri;
    if (Platform.OS === 'web' && before && before !== uri && before.startsWith('blob:')) URL.revokeObjectURL(before);
  }, [uri]);
}
