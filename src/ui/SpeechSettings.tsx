import { Platform } from 'react-native';

import { useVoicePrefs } from '@/voice/voicePrefs';
import { Section, Separator } from './components';
import { SwitchRow } from './SettingRows';

/** Speak Results and Online Speech Recognition (see voicePrefs.ts). */
export function SpeechSettings() {
  const [prefs, setPrefs] = useVoicePrefs();
  const maker = Platform.OS === 'ios' ? 'Apple' : Platform.OS === 'android' ? 'Google' : 'the browser’s maker (Google for Chrome, Apple for Safari)';
  return (
    <Section
      title="Speech"
      footer={
        `Speak Results reads results aloud with this device's voice. Leave it off if you use VoiceOver, TalkBack or ` +
        `another screen reader: it reads them already. Voice commands are recognised on this device where it can. ` +
        `Online Speech Recognition lets devices that can't do that send what you say to ${maker} to be recognised.`
      }>
      <SwitchRow
        title="Speak Results"
        hint="Reads results and answers to voice commands aloud, for use without a screen reader"
        value={prefs.speakResults}
        onChange={(v) => setPrefs({ speakResults: v })}
      />
      <Separator />
      <SwitchRow
        title="Online Speech Recognition"
        hint={`Allows voice commands on devices that can only recognise speech online. What you say is sent to ${maker}.`}
        value={prefs.onlineRecognition}
        onChange={(v) => setPrefs({ onlineRecognition: v })}
      />
    </Section>
  );
}
