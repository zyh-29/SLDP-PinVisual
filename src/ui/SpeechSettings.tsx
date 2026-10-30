import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { type AiStatus, aiStatus } from '@/voice/aiFallback';
import { useVoicePrefs } from '@/voice/voicePrefs';
import { Label, Section, Separator } from './components';
import { SwitchRow } from './SettingRows';

const AI_NOTE: Record<AiStatus, string> = {
  available: 'On-device AI: on. Sentences that aren’t listed commands get a “Did you mean …?” suggestion, worked out on this device.',
  downloadable: 'On-device AI: the browser hasn’t downloaded its model yet, so only listed commands work for now.',
  unavailable: 'On-device AI: not available on this device, so only listed commands work.',
};

/** Voice settings (see voicePrefs.ts), and whether on-device AI help is available here. */
export function SpeechSettings() {
  const [prefs, setPrefs] = useVoicePrefs();
  const [ai, setAi] = useState<AiStatus | null>(null);
  useEffect(() => {
    let live = true;
    aiStatus().then((s) => {
      if (live) setAi(s);
    });
    return () => {
      live = false;
    };
  }, []);
  const maker = Platform.OS === 'ios' ? 'Apple' : Platform.OS === 'android' ? 'Google' : 'the browser’s maker (Google for Chrome, Apple for Safari)';
  return (
    <Section
      title="Speech"
      footer={
        `Speak Results reads results aloud with this device's voice. Leave it off if you use VoiceOver, TalkBack or ` +
        `another screen reader: it reads them already. Voice commands are recognised on this device where it can. ` +
        `Online Speech Recognition lets devices that can't do that send what you say to ${maker} to be recognised. ` +
        `Online Picture Search sends what you search for to Openverse and Wikimedia Commons, which return openly licensed pictures.`
      }>
      <SwitchRow
        title="Voice Control"
        hint="Shows the voice panel on the Display tab and a voice bar on the Image tab"
        value={prefs.voiceControl}
        onChange={(v) => setPrefs({ voiceControl: v })}
      />
      <Separator />
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
      <Separator />
      <SwitchRow
        title="Online Picture Search"
        hint="Lets find pictures of something search Openverse and Wikimedia Commons on the internet"
        value={prefs.onlinePictures}
        onChange={(v) => setPrefs({ onlinePictures: v })}
      />
      {ai ? (
        <>
          <Separator />
          <Label variant="footnote" secondary style={{ paddingVertical: 10 }}>
            {AI_NOTE[ai]}
          </Label>
        </>
      ) : null}
    </Section>
  );
}
