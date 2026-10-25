import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { type SavedSequence, SequenceStore } from '@/storage/sequenceStore';

/** Local-only store (AsyncStorage on the phone, the browser's storage on web). */
export const sequenceStore = new SequenceStore(AsyncStorage);

export function useSavedSequences() {
  const [sequences, setSequences] = useState<SavedSequence[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await sequenceStore.list();
      setSequences(res.sequences);
      setSkipped(res.skipped);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  return { sequences, skipped, error, reload };
}
