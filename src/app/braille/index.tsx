import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { GRID } from '@/config/hardware';
import { sendWhenFree } from '@/device/sendWhenFree';
import { type BrailleCell, cellPattern, describeCell, toBraille } from '@/domain/braille';
import { cellsToString, createEmptyPattern } from '@/domain/pattern';
import { useDevice } from '@/state/DeviceProvider';
import { CommandStatus } from '@/ui/CommandStatus';
import { Button, Columns, Label, Screen, Section, SegmentedControl, Separator, tapFeedback } from '@/ui/components';
import { Icon, type IconName } from '@/ui/Icon';
import { PinGrid } from '@/ui/PinGrid';
import { SwitchRow } from '@/ui/SettingRows';
import { MIN_TOUCH, radius, space, type, useTheme } from '@/ui/theme';
import { announce } from '@/voice/announce';

/** Size of each pin in the overview of every cell. */
const THUMB_PIN = 9;
/** How long each cell stays up while playing, in seconds. */
const SPEEDS = ['0.5', '1', '2', '3'] as const;
type Speed = (typeof SPEEDS)[number];
/** Between two identical cells (the "ll" in "hello") the pins drop for this long, so the second one is felt. */
const GAP_MS = 250;

/**
 * Braille: type a word or a phrase and play it on the pins like a video, one braille cell after another
 * (uncontracted UEB), or step through it by hand. With a board connected each cell is sent as it's shown, and
 * while playing a cell's time starts once the board has it, so slow servos never cut a cell short. The Display
 * preview is left alone.
 */
export default function BrailleScreen() {
  const t = useTheme();
  const { state, controller } = useDevice();
  const connected = state.connection.status === 'connected';
  const [text, setText] = useState('');
  const { cells, words, skipped } = useMemo(() => toBraille(text), [text]);
  const count = cells.length;
  /** The cell shown, and which time it was shown (showing a cell again sends it again). */
  const [at, setAt] = useState({ index: 0, visit: 0 });
  const index = Math.min(at.index, Math.max(0, count - 1));
  const go = useCallback((i: number) => setAt((a) => ({ index: i, visit: a.visit + 1 })), []);
  const cell: BrailleCell | undefined = cells[index];
  const pattern = useMemo(() => cellPattern(cell ?? { dots: [], name: '' }, GRID.rows, GRID.cols), [cell]);
  const fits = GRID.rows >= 3 && GRID.cols >= 2;
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>('1');
  const [loop, setLoop] = useState(false);

  /** By hand: says the cell. While playing it stays quiet, so a reader can read the pins without being told. */
  const show = (i: number) => {
    tapFeedback();
    go(i);
    if (!playing) announce(`${describeCell(cells[i])}. Cell ${i + 1} of ${count}.`);
  };

  // Each cell goes to the board as it's shown. The same cell twice in a row drops the pins briefly in between.
  const [board, setBoard] = useState<{ visit: number; ok: boolean } | null>(null);
  const lastSent = useRef<string | null>(null);
  useEffect(() => {
    if (!connected || !cell || !fits) return;
    const key = cellsToString(pattern);
    const repeat = lastSent.current === key;
    const visit = at.visit;
    let cancelled = false;
    const send = (p: typeof pattern) => sendWhenFree(() => controller.sendPattern(p), { cancelled: () => cancelled });
    (async () => {
      if (repeat) {
        await send(createEmptyPattern(GRID.rows, GRID.cols));
        await new Promise((r) => setTimeout(r, GAP_MS));
      }
      const res = await send(pattern);
      if (!res) return;
      lastSent.current = res.ok ? key : null;
      setBoard({ visit, ok: res.ok });
      if (!res.ok) setPlaying(false);
    })();
    return () => {
      cancelled = true;
    };
    // Sent once per showing (visit); `pattern` and `cell` follow from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, at.visit, controller, fits]);
  const ready = !connected || board?.visit === at.visit;

  // Playing: move on once the cell has had its time.
  useEffect(() => {
    if (!playing || !ready) return;
    const timer = setTimeout(() => {
      if (index < count - 1) go(index + 1);
      else if (loop && count > 1) go(0);
      else {
        setPlaying(false);
        announce('Finished');
      }
    }, Number(speed) * 1000);
    return () => clearTimeout(timer);
  }, [playing, ready, index, count, loop, speed, go, at.visit]);

  const togglePlay = () => {
    tapFeedback();
    if (playing) {
      setPlaying(false);
      announce('Paused');
      return;
    }
    // At the end, Play starts again from the first cell.
    if (index >= count - 1) go(0);
    setPlaying(true);
    announce('Playing');
  };

  const sending = connected && !!cell && !ready;
  const failed = connected && board?.visit === at.visit && !board.ok;
  const status: { text: string; icon: IconName | null; color: string } = !cell
    ? { text: 'Type a word or phrase to play it in braille', icon: 'info', color: t.textSecondary }
    : !connected
      ? { text: 'On screen only · no board connected', icon: 'disconnected', color: t.textSecondary }
      : sending
        ? { text: 'Sending…', icon: null, color: t.textSecondary }
        : failed
          ? { text: 'Not received by the board', icon: 'error', color: t.warning }
          : { text: 'On the board', icon: 'success', color: t.success };
  const word = cell?.word !== undefined ? words[cell.word] : null;

  return (
    <Screen title="Braille">
      <Columns
        left={
          <>
            <Section
              title="Text"
              padded={false}
              footer={
                skipped.length
                  ? `No braille here for ${skipped.map((c) => `“${c}”`).join(', ')}: left out.`
                  : 'A word or a phrase, in uncontracted braille (UEB grade 1).'
              }>
              <View style={styles.field}>
                <TextInput
                  value={text}
                  onChangeText={(v) => {
                    setText(v);
                    setPlaying(false);
                    go(0);
                  }}
                  placeholder="Type a word or phrase"
                  placeholderTextColor={t.textSecondary}
                  autoCorrect={false}
                  returnKeyType="done"
                  enterKeyHint="done"
                  accessibilityLabel="Text to show in braille"
                  accessibilityHint="Played on the pins one braille cell at a time."
                  style={[type.body, styles.input, { color: t.text }]}
                />
              </View>
            </Section>

            <Section title="Player">
              {fits ? (
                <>
                  <View style={styles.header}>
                    <Label variant="headline" style={{ flex: 1 }} numberOfLines={1}>
                      {cell ? cell.name : 'No text yet'}
                    </Label>
                    {cell ? (
                      <Label variant="subhead" secondary style={{ fontVariant: ['tabular-nums'] }}>
                        {index + 1} of {count}
                      </Label>
                    ) : null}
                  </View>
                  <Label variant="footnote" secondary numberOfLines={1}>
                    {!cell
                      ? 'Dots 1 2 3 down the left, 4 5 6 down the right'
                      : `${cell.dots.length ? `Dot${cell.dots.length > 1 ? 's' : ''} ${cell.dots.join(' ')}` : 'No dots'}${word ? ` · in “${word}”` : ' · between words'}`}
                  </Label>
                  <View accessible accessibilityRole="image" accessibilityLabel={cell ? `Braille cell: ${describeCell(cell)}` : 'Empty braille cell'}>
                    <PinGrid pattern={pattern} />
                  </View>
                  <View
                    style={[styles.progressTrack, { backgroundColor: t.fill }]}
                    accessible
                    accessibilityRole="progressbar"
                    accessibilityLabel="Position"
                    accessibilityValue={{ min: 0, max: Math.max(1, count), now: cell ? index + 1 : 0 }}>
                    <View style={[styles.progressFill, { backgroundColor: t.tint, width: `${count ? ((index + 1) / count) * 100 : 0}%` }]} />
                  </View>
                  <View style={styles.controls}>
                    <Button
                      title="Back"
                      icon="previous"
                      variant="secondary"
                      compact
                      style={{ flex: 1 }}
                      disabled={!cell || index === 0}
                      accessibilityLabel="Previous cell"
                      onPress={() => show(index - 1)}
                    />
                    <Button
                      title={playing ? 'Pause' : 'Play'}
                      icon={playing ? 'pause' : 'play'}
                      compact
                      style={{ flex: 1 }}
                      disabled={!cell}
                      accessibilityHint={`Shows the next cell every ${speed} ${speed === '1' ? 'second' : 'seconds'}`}
                      onPress={togglePlay}
                    />
                    <Button
                      title="Next"
                      icon="next"
                      variant="secondary"
                      compact
                      style={{ flex: 1 }}
                      disabled={!cell || index >= count - 1}
                      accessibilityLabel="Next cell"
                      onPress={() => show(index + 1)}
                    />
                  </View>
                  <View style={styles.status} accessible accessibilityLabel={status.text}>
                    {status.icon ? <Icon name={status.icon} color={status.color} size={14} /> : <ActivityIndicator size="small" color={status.color} />}
                    <Label variant="footnote" style={{ color: status.color }}>
                      {status.text}
                    </Label>
                  </View>
                </>
              ) : (
                <Label variant="body" secondary>
                  A braille cell needs at least 3 rows and 2 columns of pins. This board is {GRID.rows} × {GRID.cols}.
                </Label>
              )}
            </Section>
          </>
        }
        right={
          <View style={{ gap: space.md }}>
            {!connected ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="No board connected. Open the Device tab to connect a board."
                onPress={() => router.navigate('/device')}
                style={({ pressed }) => [styles.notice, { backgroundColor: pressed ? t.cardPressed : t.card }]}>
                <Icon name="disconnected" color={t.textSecondary} size={18} />
                <Label variant="subhead" style={{ flex: 1 }}>
                  No board connected.{' '}
                  <Label variant="subhead" style={{ color: t.tint, fontWeight: '600' }}>
                    Connect…
                  </Label>
                </Label>
                <Icon name="chevron" color={t.textSecondary} size={14} />
              </Pressable>
            ) : (
              <CommandStatus
                command={state.command}
                connected={connected}
                onRetrySend={() => go(index)}
                onRetryReset={() => void controller.reset()}
              />
            )}

            <Section title="Playback">
              <View style={{ gap: space.sm, paddingBottom: space.sm }}>
                <Label variant="body">Time on Each Cell</Label>
                <SegmentedControl
                  options={SPEEDS.map((s) => ({ value: s, label: `${s} s` }))}
                  value={speed}
                  onChange={setSpeed}
                  accessibilityLabel="Time on each cell"
                />
              </View>
              <Separator />
              <SwitchRow title="Loop" hint="After the last cell, start again from the first" value={loop} onChange={setLoop} />
            </Section>

            {count > 1 && fits ? (
              <Section title={`All Cells · ${count}`} footer="Tap a cell to show it.">
                <View style={styles.strip}>
                  {cells.map((c, i) => (
                    <Pressable
                      key={i}
                      accessibilityRole="button"
                      accessibilityLabel={`Cell ${i + 1}: ${describeCell(c)}`}
                      accessibilityState={{ selected: i === index }}
                      onPress={() => show(i)}
                      style={({ pressed }) => [
                        styles.thumb,
                        { borderColor: i === index ? t.tint : 'transparent', opacity: pressed ? 0.6 : 1 },
                      ]}>
                      <PinGrid pattern={cellPattern(c, GRID.rows, GRID.cols)} cellSize={THUMB_PIN} />
                    </Pressable>
                  ))}
                </View>
              </Section>
            ) : null}
          </View>
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  field: { minHeight: MIN_TOUCH + 8, paddingHorizontal: space.lg, justifyContent: 'center' },
  input: { minHeight: MIN_TOUCH - 4, outlineStyle: 'none' } as object,
  header: { flexDirection: 'row', alignItems: 'baseline', gap: space.md },
  progressTrack: { height: 4, borderRadius: 2, overflow: 'hidden', marginTop: space.md },
  progressFill: { height: 4, borderRadius: 2 },
  controls: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  status: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: space.sm, minHeight: 20 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: space.sm + 2, minHeight: MIN_TOUCH + 4, paddingHorizontal: space.lg, borderRadius: radius.md },
  strip: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  thumb: { borderWidth: 2, borderRadius: radius.sm + 2, padding: 1, minWidth: MIN_TOUCH, minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
});
