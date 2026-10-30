import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import type { useVoiceCommands } from '@/voice/useVoiceCommands';
import { Button, Label } from './components';
import { radius, space, type, useTheme } from './theme';

type Voice = ReturnType<typeof useVoiceCommands>;

/**
 * Voice commands, at the top of the Display tab so a screen reader reaches it before the 30 pins: a large Speak
 * button, a box to type the same commands, what was heard and the answer, and Yes / Cancel when the board is
 * about to move.
 */
export function VoicePanel({ voice }: { voice: Voice }) {
  const t = useTheme();
  const [text, setText] = useState('');
  const { phase, heard, reply, pending, support, onlineAllowed } = voice;

  // Whether the Speak button can work here, and if not, why (typing still works everywhere).
  const canSpeak = !!support?.available && (support.onDevice || onlineAllowed);
  const note = !support
    ? null
    : !support.available
      ? 'Speaking commands isn’t available here. Type them instead.'
      : !support.onDevice && !onlineAllowed
        ? 'Here, speech can only be recognised online by the browser’s or phone’s maker. Turn on Online Speech Recognition in the Device tab to speak commands, or type them.'
        : !support.onDevice
          ? 'Speech is recognised online by the browser’s or phone’s maker.'
          : null;

  const submit = () => {
    voice.runText(text);
    setText('');
  };

  return (
    <View style={{ gap: space.md }}>
      {support?.available !== false ? (
        <Button
          title={phase === 'listening' ? 'Listening… Tap to Stop' : phase === 'downloading' ? 'Getting Voice Ready…' : 'Speak'}
          icon="mic"
          onPress={canSpeak ? voice.toggleListening : () => router.navigate('/device')}
          loading={phase === 'downloading'}
          variant={phase === 'listening' ? 'destructive' : 'primary'}
          style={styles.speak}
          accessibilityLabel={phase === 'listening' ? 'Listening. Double-tap to stop.' : canSpeak ? 'Speak a command' : 'Speak a command, needs a setting'}
          accessibilityHint={
            canSpeak
              ? 'After the tone, say a command such as show a circle, or say help. On iPhone, a two-finger double-tap anywhere on this tab also starts listening.'
              : 'Opens the Device tab, where Online Speech Recognition can be turned on.'
          }
        />
      ) : null}
      {note ? (
        <Label variant="footnote" secondary>
          {note}
        </Label>
      ) : null}

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
          accessibilityHint="The same commands as speaking, for example show letter A, or raise row 2 column 3. Then press Go."
          style={[type.body, styles.input, { color: t.text, backgroundColor: t.fill }]}
        />
        <Button title="Go" onPress={submit} disabled={!text.trim()} style={styles.go} accessibilityHint="Runs the typed command" />
      </View>

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

      {pending ? (
        <View style={styles.row}>
          <Button
            title={pending === 'send' ? 'Yes, Send' : 'Yes, Lower Pins'}
            icon={pending === 'send' ? 'send' : 'reset'}
            variant={pending === 'send' ? 'primary' : 'destructive'}
            onPress={voice.confirm}
            style={{ flex: 1 }}
          />
          <Button title="Cancel" variant="secondary" onPress={voice.cancel} style={{ flex: 1 }} />
        </View>
      ) : null}

      <Button
        title="What Can I Say?"
        icon="help"
        variant="plain"
        compact
        onPress={() => voice.runText('help')}
        accessibilityHint="Lists the commands, out loud and below"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  speak: { minHeight: 64 },
  row: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  input: { flex: 1, minHeight: 50, paddingHorizontal: space.md, borderRadius: radius.sm },
  go: { flexShrink: 0 },
  answer: { padding: space.md, borderRadius: radius.sm, gap: space.xs },
});
