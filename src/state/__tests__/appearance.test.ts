import { Appearance } from 'react-native';

import { APPEARANCE_KEY, getAppearance, isAppearancePref, setAppearance } from '../appearance';

// Jest moves this above the imports, so the store sees the fake storage.
const mockStored = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = {
    getItem: jest.fn(async (k: string) => mockStored.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => void mockStored.set(k, v)),
  };
  return { __esModule: true, default: store };
});

describe('appearance choice', () => {
  it('starts on Automatic', () => {
    expect(getAppearance()).toBe('auto');
  });

  it('only accepts Automatic, Light or Dark (a damaged saved value is ignored)', () => {
    for (const v of ['auto', 'light', 'dark']) expect(isAppearancePref(v)).toBe(true);
    for (const v of ['Dark', 'system', '', null, 1]) expect(isAppearancePref(v)).toBe(false);
  });

  it('is saved on the device, and the phone app follows it, system parts too', () => {
    const spy = jest.spyOn(Appearance, 'setColorScheme').mockImplementation(() => {});
    setAppearance('dark');
    expect(getAppearance()).toBe('dark');
    expect(mockStored.get(APPEARANCE_KEY)).toBe('dark');
    expect(spy).toHaveBeenLastCalledWith('dark');
    setAppearance('auto');
    expect(spy).toHaveBeenLastCalledWith('auto');
    expect(mockStored.get(APPEARANCE_KEY)).toBe('auto');
  });
});
