import { migrateVoicePrefs, parseVoicePrefs } from '../voicePrefs';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

describe('voice settings', () => {
  it('searches for pictures by default', () => {
    expect(parseVoicePrefs(null).onlinePictures).toBe(true);
  });

  it('keeps a choice made under the new settings', () => {
    expect(parseVoicePrefs('{"onlinePictures":false}').onlinePictures).toBe(false);
  });

  it('moves old settings over without their saved picture search, which was the old default', () => {
    const moved = parseVoicePrefs(migrateVoicePrefs('{"speakResults":true,"voiceControl":true,"onlinePictures":false}'));
    expect(moved).toEqual({ speakResults: true, onlineRecognition: false, voiceControl: true, onlinePictures: true });
    expect(migrateVoicePrefs(null)).toBeNull();
    expect(migrateVoicePrefs('not json')).toBeNull();
  });
});
