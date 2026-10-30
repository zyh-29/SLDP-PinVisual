import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { credit } from '@/voice/pictureSearch';
import { useVoice } from '@/voice/VoiceProvider';
import { Button, Label } from './components';
import { radius, space, type, useTheme } from './theme';

/** Whether the Speak button can work here, and if not, why (typing works everywhere). */
function useSpeakable() {
  const { support, prefs } = useVoice();
  const canSpeak = !!support?.available && (support.onDevice || prefs.onlineRecognition);
  const note = !support
    ? null
    : !support.available
      ? 'Speaking commands isn’t available here. Type them instead.'
      : !support.onDevice && !prefs.onlineRecognition
        ? 'Here, speech can only be recognised online by the browser’s or phone’s maker. Turn on Online Speech Recognition in the Device tab to speak commands, or type them.'
        : !support.onDevice
          ? 'Speech is recognised online by the browser’s or phone’s maker.'
          : null;
  return { canSpeak, note, available: support?.available !== false };
}

const PHASE_TITLE = {
  idle: 'Speak',
  listening: 'Listening… Tap to Stop',
  downloading: 'Getting Voice Ready…',
  thinking: 'Working Out What You Meant…',
  searching: 'Searching for Pictures…',
} as const;

function SpeakButton({ large }: { large?: boolean }) {
  const voice = useVoice();
  const { canSpeak, available } = useSpeakable();
  if (!available) return null;
  const { phase } = voice;
  const busy = phase === 'downloading' || phase === 'thinking' || phase === 'searching';
  return (
    <Button
      title={PHASE_TITLE[phase]}
      icon="mic"
      onPress={canSpeak ? voice.toggleListening : () => router.navigate('/device')}
      loading={busy}
      variant={phase === 'listening' ? 'destructive' : 'primary'}
      compact={!large}
      style={large ? styles.speak : styles.speakSmall}
      accessibilityLabel={phase === 'listening' ? 'Listening. Double-tap to stop.' : canSpeak ? 'Speak a command' : 'Speak a command, needs a setting'}
      accessibilityHint={
        canSpeak
          ? 'After the tone, say a command such as show a circle, or say help. On iPhone, a two-finger double-tap also starts listening.'
          : 'Opens the Device tab, where Online Speech Recognition can be turned on.'
      }
    />
  );
}

/**
 * What was heard, the answer, and Yes / Cancel when something waits for a yes. `pictureUri`: the Image tab's
 * picture, whose credit is shown when it came from picture search.
 */
function Conversation({ pictureUri }: { pictureUri?: string }) {
  const t = useTheme();
  const voice = useVoice();
  const { heard, reply, pending, picture } = voice;
  const yesTitle = pending === 'send' ? 'Yes, Send' : pending === 'reset' ? 'Yes, Lower Pins' : 'Yes';
  return (
    <>
      {heard || reply ? (
        <View style={[styles.answer, { backgroundColor: t.fill }]} accessible accessibilityLabel={[heard ? `Heard: ${heard}.` : '', reply].join(' ').trim()}>
          {heard ? (
            <Label variant="footnote" secondary>
              Heard: “{heard}”
            </Label>
          ) : null}
          {reply ? <Label variant="body">{reply}</Label> : null}
        </View>
      ) : null}
      {picture && picture.uri === pictureUri ? (
        <Label variant="footnote" secondary>
          Picture: {credit(picture)}
        </Label>
      ) : null}
      {pending ? (
        <View style={styles.row}>
          <Button
            title={yesTitle}
            icon={pending === 'send' ? 'send' : pending === 'reset' ? 'reset' : 'success'}
            variant={pending === 'reset' ? 'destructive' : 'primary'}
            onPress={voice.confirm}
            style={{ flex: 1 }}
          />
          <Button title="Cancel" variant="secondary" onPress={voice.cancel} style={{ flex: 1 }} />
        </View>
      ) : null}
    </>
  );
}

function CommandBox() {
  const t = useTheme();
  const voice = useVoice();
  const [text, setText] = useState('');
  const submit = () => {
    voice.runText(text);
    setText('');
  };
  return (
    <View style={styles.row}>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="Or type a command"
        placeholderTextColor={t.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="go"
        onSubmitEditing={submit}
        accessibilityLabel="Type a command"
        accessibilityHint="The same commands as speaking, for example show letter A, or graph y equals x squared. Then press Go."
        style={[type.body, styles.input, { color: t.text, backgroundColor: t.fill }]}
      />
      <Button title="Go" onPress={submit} disabled={!text.trim()} style={styles.go} accessibilityHint="Runs the typed command" />
    </View>
  );
}

/**
 * The Display tab's voice control: closed, one "Voice Control" button; open (remembered), the Speak button, a box to
 * type the same commands, and the conversation. It comes before the 30 pins, so a screen reader reaches it first.
 */
export function VoicePanel() {
  const voice = useVoice();
  const { note } = useSpeakable();
  if (!voice.prefs.voiceControl)
    return (
      <Button
        title="Voice Control"
        icon="mic"
        variant="secondary"
        onPress={() => voice.setPrefs({ voiceControl: true })}
        accessibilityHint="Shows voice commands: speak or type things like show a circle, graph y equals x squared, or start camera."
      />
    );
  return (
    <View style={{ gap: space.md }}>
      <SpeakButton large />
      {note ? (
        <Label variant="footnote" secondary>
          {note}
        </Label>
      ) : null}
      <CommandBox />
      <Conversation />
      <View style={styles.row}>
        <Button title="What Can I Say?" icon="help" variant="plain" compact onPress={() => voice.runText('help')} style={{ flex: 1 }} />
        <Button
          title="Turn Off"
          variant="plain"
          compact
          onPress={() => voice.setPrefs({ voiceControl: false })}
          accessibilityLabel="Turn off voice control"
          style={{ flex: 1 }}
        />
      </View>
    </View>
  );
}

/** The Image tab's bar, shown while voice control is on: speak or type, and the conversation. */
export function VoiceBar({ pictureUri }: { pictureUri?: string }) {
  const voice = useVoice();
  if (!voice.prefs.voiceControl) return null;
  return (
    <View style={{ gap: space.sm }}>
      <SpeakButton />
      <CommandBox />
      <Conversation pictureUri={pictureUri} />
    </View>
  );
}

const styles = StyleSheet.create({
  speak: { minHeight: 64 },
  speakSmall: { minHeight: 48 },
  row: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  input: { flex: 1, minHeight: 50, paddingHorizontal: space.md, borderRadius: radius.sm },
  go: { flexShrink: 0 },
  answer: { padding: space.md, borderRadius: radius.sm, gap: space.xs },
});
