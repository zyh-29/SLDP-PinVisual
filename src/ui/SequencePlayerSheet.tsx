import { useCallback, useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, View } from 'react-native';

import { GRID } from '@/config/hardware';
import { createEmptyPattern, fitPatternToGrid, type Pattern } from '@/domain/pattern';
import { sendWhenFree } from '@/device/sendWhenFree';
import { useDevice } from '@/state/DeviceProvider';
import { nextStep, previousStep, type SavedSequence, stepPattern } from '@/storage/sequenceStore';
import { Button, Label, SegmentedControl, Separator, StatusBanner } from './components';
import { PinGrid } from './PinGrid';
import { SwitchRow } from './SettingRows';
import { Sheet } from './Sheet';
import { MIN_TOUCH, radius, space, useTheme } from './theme';

/** How long each step stays up while playing, in seconds. */
const SPEEDS = ['2', '5', '10', '20'] as const;
type Speed = (typeof SPEEDS)[number];

/**
 * Plays a sequence: each step is shown here and, with a board connected, sent to it. While playing, a step's time
 * starts once the board has acknowledged it, so slow servos never cut a step short.
 */
export function SequencePlayerSheet({ sequence, onClose }: { sequence: SavedSequence; onClose: () => void }) {
  const t = useTheme();
  const { state, controller } = useDevice();
  const connected = state.connection.status === 'connected';
  /** The step shown, and which time it was shown (going back to a step sends it again). */
  const [at, setAt] = useState({ index: 0, visit: 0 });
  const index = at.index;
  const go = useCallback((i: number) => setAt((a) => ({ index: i, visit: a.visit + 1 })), []);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>('5');
  const [loop, setLoop] = useState(false);
  /** The board's answer for the last step sent (by visit): acknowledged, or why not. */
  const [board, setBoard] = useState<{ visit: number; ok: boolean; message?: string } | null>(null);

  // A step made for another grid size is fitted (cropped or padded equally on each side).
  const patterns = useMemo<Pattern[]>(
    () =>
      sequence.steps.map((s) => {
        const p = stepPattern(s);
        return p ? fitPatternToGrid(p, GRID.rows, GRID.cols) : createEmptyPattern(GRID.rows, GRID.cols);
      }),
    [sequence],
  );
  const count = patterns.length;
  const step = sequence.steps[index];
  /** The current step is on the board (or there's no board, so it's only shown here). */
  const ready = !connected || board?.visit === at.visit;

  // Each step goes to the board as soon as it's shown.
  useEffect(() => {
    if (!connected) return;
    const { index: i, visit } = at;
    let cancelled = false;
    // The step before may still be on its way (the user skipped ahead): this one goes as soon as it's done.
    sendWhenFree(() => controller.sendPattern(patterns[i]), { cancelled: () => cancelled }).then((res) => {
      if (!res) return;
      setBoard({ visit, ok: res.ok, message: res.ok ? undefined : res.message });
      if (!res.ok) setPlaying(false);
    });
    return () => {
      cancelled = true;
    };
  }, [connected, controller, patterns, at]);

  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(`Step ${index + 1} of ${count}: ${sequence.steps[index]?.name ?? ''}`);
  }, [index, count, sequence]);

  // Playing: move on once the step has had its time.
  useEffect(() => {
    if (!playing || !ready) return;
    const timer = setTimeout(() => {
      const next = nextStep(at.index, count, loop);
      if (next === null) setPlaying(false);
      else go(next);
    }, Number(speed) * 1000);
    return () => clearTimeout(timer);
  }, [playing, ready, at, count, loop, speed, go]);

  const togglePlay = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    // At the end of a sequence that doesn't loop, Play starts again from the first step.
    if (nextStep(index, count, loop) === null) go(0);
    setPlaying(true);
  };

  const sending = connected && !ready;
  const failed = connected && board?.visit === at.visit && !board.ok ? board.message : null;

  return (
    <Sheet title={sequence.name} action="Done" onAction={onClose}>
      <PinGrid pattern={patterns[index]} />
      <View style={{ gap: 2 }}>
        <Label variant="headline">
          Step {index + 1} of {count} · {step?.name}
        </Label>
        <Label variant="footnote" secondary>
          {!connected
            ? 'No board connected: playing on screen only. Connect a board on the Device tab to play it on the pins.'
            : sending
              ? 'Sending to the board…'
              : failed
                ? 'Not on the board.'
                : 'On the board.'}
        </Label>
      </View>
      {failed ? <StatusBanner tone="error" title="The board didn’t take this step" message={failed} /> : null}

      <View style={styles.controls}>
        <Button
          title="Back"
          icon="previous"
          variant="secondary"
          style={{ flex: 1 }}
          disabled={!loop && index === 0}
          onPress={() => go(previousStep(index, count, loop))}
          accessibilityLabel="Previous step"
        />
        <Button
          title={playing ? 'Pause' : 'Play'}
          icon={playing ? 'pause' : 'play'}
          style={{ flex: 1 }}
          onPress={togglePlay}
          accessibilityHint={`Moves to the next step every ${speed} seconds`}
        />
        <Button
          title="Next"
          icon="next"
          variant="secondary"
          style={{ flex: 1 }}
          disabled={nextStep(index, count, loop) === null}
          onPress={() => go(nextStep(index, count, loop) ?? index)}
          accessibilityLabel="Next step"
        />
      </View>

      <View style={[styles.card, { backgroundColor: t.card }]}>
        <View style={{ padding: space.lg, gap: space.sm }}>
          <Label variant="body">Time on Each Step</Label>
          <SegmentedControl
            options={SPEEDS.map((s) => ({ value: s, label: `${s} s` }))}
            value={speed}
            onChange={setSpeed}
            accessibilityLabel="Time on each step"
          />
        </View>
        <Separator inset={space.lg} />
        <View style={{ paddingHorizontal: space.lg }}>
          <SwitchRow title="Loop" hint="After the last step, start again from the first" value={loop} onChange={setLoop} />
        </View>
      </View>

      <Label variant="footnote" secondary accessibilityRole="header" style={styles.groupTitle}>
        {`STEPS · ${count}`}
      </Label>
      <View style={[styles.card, { backgroundColor: t.card }]}>
        {sequence.steps.map((s, i) => {
          const current = i === index;
          return (
            <View key={i}>
              {i > 0 ? <Separator inset={space.lg} /> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Step ${i + 1}, ${s.name}`}
                accessibilityState={{ selected: current }}
                accessibilityHint="Shows this step"
                onPress={() => go(i)}
                style={({ pressed }) => [styles.row, { backgroundColor: current ? t.tintSoft : pressed ? t.cardPressed : 'transparent' }]}>
                <Label variant="headline" secondary style={styles.number}>
                  {i + 1}
                </Label>
                <PinGrid pattern={patterns[i]} cellSize={7} />
                <Label variant="body" numberOfLines={1} style={{ flex: 1, color: current ? t.tint : t.text, fontWeight: current ? '600' : '400' }}>
                  {s.name}
                </Label>
              </Pressable>
            </View>
          );
        })}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  controls: { flexDirection: 'row', gap: space.sm },
  card: { borderRadius: radius.lg, overflow: 'hidden' },
  groupTitle: { marginLeft: space.lg, marginTop: space.sm, fontWeight: '500' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.sm, minHeight: MIN_TOUCH + 8 },
  number: { width: 24, textAlign: 'center', fontVariant: ['tabular-nums'] },
});
