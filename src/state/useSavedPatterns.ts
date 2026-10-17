import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { PatternStore, type SavedPattern } from '@/storage/patternStore';

/** Local-only store (AsyncStorage on the phone). */
export const patternStore = new PatternStore(AsyncStorage);

export function useSavedPatterns() {
  const [patterns, setPatterns] = useState<SavedPattern[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await patternStore.list();
      setPatterns(res.patterns);
      setSkipped(res.skipped);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  return { patterns, skipped, loading, error, reload };
}
