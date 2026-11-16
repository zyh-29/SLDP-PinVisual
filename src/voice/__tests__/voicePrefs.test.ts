import { migrateVoicePrefs, parseVoicePrefs } from '../voicePrefs';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

describe('voice settings', () => {
  it('starts with everything off', () => {
    expect(parseVoicePrefs(null)).toEqual({ speakResults: false, onlineRecognition: false, voiceControl: false });
  });

  it('moves old settings over, dropping ones the app no longer has', () => {
    const moved = parseVoicePrefs(migrateVoicePrefs('{"speakResults":true,"voiceControl":true,"onlinePictures":false}'));
    expect(moved).toEqual({ speakResults: true, onlineRecognition: false, voiceControl: true });
    expect(migrateVoicePrefs(null)).toBeNull();
    expect(migrateVoicePrefs('not json')).toBeNull();
  });
});
