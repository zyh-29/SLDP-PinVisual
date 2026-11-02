import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { HELP_TEXT } from '@/voice/commands';
import { credit } from '@/voice/pictureSearch';
import { useVoice } from '@/voice/VoiceProvider';
import { Button, Label, tapFeedback } from './components';
import { Icon } from './Icon';
import { MIN_TOUCH, radius, space, type, useTheme } from './theme';

/** Whether the microphone can work here, and if not, why (typing works everywhere). */
function useSpeakable() {
  const { support, prefs } = useVoice();
  const canSpeak = !!support?.available && (support.onDevice || prefs.onlineRecognition);
  const note = !support
    ? null
    : !support.available
      ? 'Speaking commands isn’t available here. Type them instead.'
      : !support.onDevice && !prefs.onlineRecognition
        ? 'To speak commands here, turn on Online Speech Recognition in the Device tab. Typing works as it is.'
        : !support.onDevice
          ? 'Speech is recognised online by the browser’s or phone’s maker.'
          : null;
  return { canSpeak, note, available: support?.available !== false };
}

const PLACEHOLDER = {
  idle: 'Type or speak a command',
  listening: 'Listening…',
  downloading: 'Getting voice ready…',
  thinking: 'Working out what you meant…',
  searching: 'Searching for pictures…',
} as const;

/**
 * The navigation-bar button that shows or hides voice control (remembered). Shown on the Display and Image tabs.
 */
export function VoiceToggle() {
  const t = useTheme();
  const voice = useVoice();
  const on = voice.prefs.voiceControl;
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel="Voice Control"
      accessibilityState={{ checked: on }}
      accessibilityHint="Shows a command field: speak or type things like show a circle, graph y equals x squared, or start camera."
      onPress={() => {
        tapFeedback();
        voice.setPrefs({ voiceControl: !on });
      }}
      hitSlop={6}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.toggle,
        { backgroundColor: on ? t.tintFill : t.tintSoft, opacity: pressed ? 0.7 : hovered ? 0.85 : 1 },
      ]}>
      <Icon name="mic" color={on ? t.onTint : t.tint} size={16} />
      <Text style={[type.subhead, { color: on ? t.onTint : t.tint, fontWeight: '600' }]}>Voice</Text>
    </Pressable>
  );
}

/** The command field: type a command and press return, or tap the microphone inside it and speak. */
function CommandField() {
  const t = useTheme();
  const voice = useVoice();
  const { canSpeak, available } = useSpeakable();
  const [text, setText] = useState('');
  const { phase } = voice;
  const listening = phase === 'listening';
  const busy = phase === 'downloading' || phase === 'thinking' || phase === 'searching';
  const submit = () => {
    if (!text.trim()) return;
    voice.runText(text);
    setText('');
  };
  return (
    <View style={styles.fieldRow}>
      <View style={[styles.field, { backgroundColor: t.card, borderColor: listening ? t.destructive : 'transparent' }]}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={PLACEHOLDER[phase]}
          placeholderTextColor={listening ? t.destructive : t.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          enterKeyHint="go"
          onSubmitEditing={submit}
          accessibilityLabel="Command"
          accessibilityHint="Type a command such as show letter A, or graph y equals x squared, then press return."
          style={[type.body, styles.input, { color: t.text }]}
        />
        {available ? (
          busy ? (
            <View style={styles.mic}>
              <ActivityIndicator color={t.textSecondary} />
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={listening ? 'Stop listening' : canSpeak ? 'Speak a command' : 'Speak a command, needs a setting'}
              accessibilityHint={
                listening
                  ? undefined
                  : canSpeak
                    ? 'After the tone, say a command such as show a circle, or say help. On iPhone, a two-finger double-tap also starts listening.'
                    : 'Opens the Device tab, where Online Speech Recognition can be turned on.'
              }
              onPress={() => {
                tapFeedback();
                if (canSpeak) voice.toggleListening();
                else router.navigate('/device');
              }}
              style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                styles.mic,
                listening && { backgroundColor: t.destructive },
                !listening && (pressed || hovered) && { backgroundColor: t.fill },
              ]}>
              <Icon name={listening ? 'stop' : 'mic'} color={listening ? '#FFFFFF' : t.tint} size={20} />
            </Pressable>
          )
        ) : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="What can I say?"
        onPress={() => {
          tapFeedback();
          voice.runText('help');
        }}
        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
          styles.helpButton,
          (pressed || hovered) && { backgroundColor: t.fill },
        ]}>
        <Icon name="help" color={t.tint} size={22} />
      </Pressable>
    </View>
  );
}

/** "What can I say?", grouped. Every example can be tapped to run it. */
const HELP_GROUPS: { title: string; examples: string[] }[] = [
  { title: 'Pins', examples: ['show a circle', 'show a circle outline', 'letter B', 'number 3', 'raise row 2 column 3', 'invert', 'undo', 'clear'] },
  { title: 'Board', examples: ["what's on the board", 'read row 2', 'send', 'reset'] },
  { title: 'Pictures', examples: ['find pictures of a cat', 'next', 'start camera', 'capture', 'choose photo', 'use this pattern', 'remove background on'] },
  { title: 'Graphs', examples: ['graph y equals x squared', 'plot sine of x'] },
  { title: 'Getting around', examples: ['go to image', 'open saved', 'repeat', 'stop'] },
];

function CommandHelp() {
  const t = useTheme();
  const voice = useVoice();
  return (
    <View style={{ gap: space.lg }} accessibilityLabel="Things you can say">
      {HELP_GROUPS.map((g) => (
        <View key={g.title} style={{ gap: space.sm }}>
          <Text accessibilityRole="header" style={[type.footnote, { color: t.textSecondary, fontWeight: '600' }]}>
            {g.title.toUpperCase()}
          </Text>
          <View style={styles.chips}>
            {g.examples.map((e) => (
              <Pressable
                key={e}
                accessibilityRole="button"
                accessibilityLabel={e}
                accessibilityHint="Runs this command"
                onPress={() => {
                  tapFeedback();
                  voice.runText(e);
                }}
                style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                  styles.chip,
                  { backgroundColor: t.tintSoft, opacity: pressed ? 0.6 : hovered ? 0.8 : 1 },
                ]}>
                <Text style={[type.subhead, { color: t.tint, fontWeight: '500' }]}>{e}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ))}
      <Label variant="footnote" secondary>
        Tap one to try it. Shapes are solid; add “outline” for just the edge. Say “stop” to quiet the voice.
      </Label>
    </View>
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
  const help = reply === HELP_TEXT;
  const credited = picture && picture.uri === pictureUri;
  if (!heard && !reply && !pending && !credited) return null;
  return (
    <View style={[styles.card, { backgroundColor: t.card }]}>
      {heard || reply ? (
        <View
          style={{ gap: space.xs }}
          accessible={!help}
          accessibilityLabel={help ? undefined : [heard ? `Heard: ${heard}.` : '', reply].join(' ').trim()}>
          {heard && !help ? (
            <Label variant="footnote" secondary>
              “{heard}”
            </Label>
          ) : null}
          {help ? <CommandHelp /> : reply ? <Label variant="body">{reply}</Label> : null}
        </View>
      ) : null}
      {credited ? (
        <Label variant="footnote" secondary>
          Picture: {credit(picture)}
        </Label>
      ) : null}
      {pending ? (
        <View style={styles.actions}>
          <Button title="Cancel" variant="secondary" compact onPress={voice.cancel} />
          <Button
            title={yesTitle}
            variant={pending === 'reset' ? 'destructive' : 'primary'}
            compact
            onPress={voice.confirm}
          />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Voice control under the page title, where iOS puts a search field: the command field (with the microphone in
 * it), then the conversation. Shown while Voice Control is on (the header's Voice button), on the Display and Image
 * tabs. It comes before everything else on the page, so a screen reader reaches it first.
 */
export function VoiceBar({ pictureUri }: { pictureUri?: string }) {
  const voice = useVoice();
  const { note } = useSpeakable();
  if (!voice.prefs.voiceControl) return null;
  return (
    <View style={{ gap: space.sm }}>
      <CommandField />
      {note ? (
        <Label variant="footnote" secondary style={{ marginHorizontal: space.lg }}>
          {note}
        </Label>
      ) : null}
      <Conversation pictureUri={pictureUri} />
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 34,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
  },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: MIN_TOUCH,
    borderRadius: radius.md - 2,
    borderWidth: 1.5,
    paddingLeft: space.md,
    paddingRight: 4,
  },
  input: { flex: 1, minHeight: MIN_TOUCH - 4, outlineStyle: 'none' } as object,
  mic: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  helpButton: { width: MIN_TOUCH, height: MIN_TOUCH, borderRadius: MIN_TOUCH / 2, alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: radius.lg, padding: space.lg, gap: space.md },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { minHeight: 36, justifyContent: 'center', paddingHorizontal: space.md + 2, borderRadius: radius.pill },
});
