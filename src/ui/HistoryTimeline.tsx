import { memo, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, type LayoutChangeEvent, Platform, Pressable, ScrollView, type ScrollViewInstance, StyleSheet, View } from 'react-native';

import type { Pattern } from '@/domain/pattern';
import { describeStep, MAX_UNDO, type Preview } from '@/state/previewHistory';
import { Label, tapFeedback } from './components';
import { Icon, type IconName } from './Icon';
import { MIN_TOUCH, radius, space, type Palette, useTheme } from './theme';

/** One step's tile: a small drawing of the pins at that step. Also its touch target. */
const TILE = 44;
const GAP = 6;
/** The playhead sits in the gap after the step showing. */
const HEAD = 14;
/** The step arrows: Material's triangles fill less of their box than SF Symbols' do. */
const STEP_ICON = Platform.OS === 'ios' ? 17 : 28;
/** Side by side (transport, then the strip) from this width; stacked below it (phones). */
const WIDE = 520;

/**
 * The preview's history as a timeline, like Fusion 360's: every step in order, the one showing marked by the
 * playhead, undone steps faded after it. Tap a step to jump there; the buttons go to the start, back one,
 * forward one and to the latest. Never moves the physical pins.
 */
export function HistoryTimeline({ steps, position, onJump }: { steps: Preview[]; position: number; onJump: (index: number) => void }) {
  const t = useTheme();
  const [width, setWidth] = useState(0);
  const [viewport, setViewport] = useState(0);
  const scroll = useRef<ScrollViewInstance>(null);
  const last = steps.length - 1;
  const trimmed = steps.length > MAX_UNDO;
  const describe = (i: number) => describeStep(steps[i - 1], steps[i], trimmed).text;

  // Keep the playhead in view: centred when it can be, scrolled to the end for the newest step.
  useEffect(() => {
    if (!viewport) return;
    const x = space.md + position * (TILE + GAP) + TILE / 2 - viewport / 2;
    scroll.current?.scrollTo({ x: Math.max(0, x), animated: true });
  }, [position, steps.length, viewport]);

  const jump = (i: number) => {
    const to = Math.max(0, Math.min(last, i));
    if (to === position) return;
    tapFeedback();
    onJump(to);
    AccessibilityInfo.announceForAccessibility(`Step ${to + 1} of ${steps.length}: ${describe(to)}`);
  };

  const transport = (
    <View style={styles.transport}>
      <Transport icon="previous" label="Back to start" disabled={position === 0} onPress={() => jump(0)} colors={t} />
      <Transport icon="stepBack" label="Undo" disabled={position === 0} onPress={() => jump(position - 1)} colors={t} />
      <Transport icon="stepForward" label="Redo" disabled={position === last} onPress={() => jump(position + 1)} colors={t} />
      <Transport icon="next" label="Forward to latest" disabled={position === last} onPress={() => jump(last)} colors={t} />
    </View>
  );

  const strip = (
    <ScrollView
      ref={scroll}
      horizontal
      showsHorizontalScrollIndicator={false}
      onLayout={(e: LayoutChangeEvent) => setViewport(e.nativeEvent.layout.width)}
      style={{ flex: 1 }}
      contentContainerStyle={styles.strip}>
      {/* The track along the bottom, with a tick under each step. */}
      <View style={[styles.track, { backgroundColor: t.separator }]} />
      {steps.map((s, i) => (
        <View key={i} style={styles.stepSlot}>
          <Step
            pattern={s.pattern}
            index={i}
            count={steps.length}
            text={describe(i)}
            current={i === position}
            undone={i > position}
            onPress={jump}
            colors={t}
          />
          <View style={[styles.tick, { backgroundColor: i <= position ? t.textSecondary : t.separator }]} />
          {i === position ? <Playhead colors={t} /> : null}
        </View>
      ))}
    </ScrollView>
  );

  const wide = width >= WIDE;
  const undone = last - position;
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={[styles.panel, { backgroundColor: t.gridWell }]}>
      {wide ? (
        <View style={styles.wideRow}>
          {transport}
          <View style={[styles.divider, { backgroundColor: t.separator }]} />
          {strip}
        </View>
      ) : (
        <>
          {strip}
          <View style={styles.narrowRow}>{transport}</View>
        </>
      )}
      <Label variant="footnote" secondary style={styles.caption} numberOfLines={1} accessibilityLiveRegion="polite">
        <Label variant="footnote" style={{ color: t.text, fontWeight: '600' }}>
          Step {position + 1} of {steps.length}
        </Label>
        {` · ${describe(position)}`}
        {undone ? ` · ${undone} undone` : ''}
      </Label>
    </View>
  );
}

function Transport({
  icon,
  label,
  disabled,
  onPress,
  colors: t,
}: {
  icon: IconName;
  label: string;
  disabled: boolean;
  onPress: () => void;
  colors: Palette;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Changes the preview only. Does not move the physical pins."
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.transportButton,
        { backgroundColor: pressed ? t.cardPressed : hovered && !disabled ? t.fill : 'transparent' },
      ]}>
      <Icon name={icon} color={disabled ? t.separator : t.tint} size={icon === 'stepBack' || icon === 'stepForward' ? STEP_ICON : 20} />
    </Pressable>
  );
}

/** The marker after the step showing: a line with a knob on top, in the tint colour. */
function Playhead({ colors: t }: { colors: Palette }) {
  return (
    <View pointerEvents="none" style={styles.head}>
      <View style={[styles.headKnob, { backgroundColor: t.tint }]} />
      <View style={[styles.headLine, { backgroundColor: t.tint }]} />
    </View>
  );
}

const Step = memo(function Step({
  pattern,
  index,
  count,
  text,
  current,
  undone,
  onPress,
  colors: t,
}: {
  pattern: Pattern;
  index: number;
  count: number;
  text: string;
  current: boolean;
  undone: boolean;
  onPress: (index: number) => void;
  colors: Palette;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Step ${index + 1} of ${count}: ${text}${undone ? ', undone' : ''}`}
      accessibilityState={{ selected: current }}
      accessibilityHint={current ? undefined : 'Jumps the preview to this step. Does not move the physical pins.'}
      onPress={() => onPress(index)}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.tile,
        {
          backgroundColor: pressed || hovered ? t.cardPressed : t.card,
          borderColor: current ? t.tint : 'transparent',
          opacity: undone ? 0.4 : 1,
        },
      ]}>
      <MiniPins pattern={pattern} colors={t} />
    </Pressable>
  );
});

/** The pins at one step, a few points across each: raised are solid dots, lowered faint ones. */
function MiniPins({ pattern, colors: t }: { pattern: Pattern; colors: Palette }) {
  const dot = Math.max(2, Math.floor(30 / Math.max(pattern.cols, pattern.rows)) - 1);
  return (
    <View style={{ gap: 1 }}>
      {Array.from({ length: pattern.rows }, (_, r) => (
        <View key={r} style={{ flexDirection: 'row', gap: 1 }}>
          {Array.from({ length: pattern.cols }, (_, c) => {
            const raised = pattern.cells[r * pattern.cols + c] === 1;
            return (
              <View
                key={c}
                style={{
                  width: dot,
                  height: dot,
                  borderRadius: dot / 2,
                  backgroundColor: raised ? t.pinRaised : t.pinLoweredBorder,
                  opacity: raised ? 1 : 0.3,
                }}
              />
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderRadius: radius.md, paddingTop: space.sm, paddingBottom: space.sm, gap: space.xs },
  wideRow: { flexDirection: 'row', alignItems: 'center' },
  narrowRow: { flexDirection: 'row', justifyContent: 'center' },
  divider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', marginVertical: space.sm },
  transport: { flexDirection: 'row', paddingHorizontal: space.xs },
  transportButton: { width: MIN_TOUCH, height: MIN_TOUCH, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  strip: { paddingHorizontal: space.md, paddingTop: space.md, paddingBottom: space.xs, gap: GAP, flexDirection: 'row' },
  track: { position: 'absolute', left: space.md, right: space.md, bottom: space.xs + 2, height: 2, borderRadius: 1 },
  stepSlot: { alignItems: 'center' },
  tile: { width: TILE, height: TILE - 6, borderRadius: radius.sm, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  tick: { width: 1.5, height: 10, marginTop: 2 },
  head: { position: 'absolute', top: -space.md + 2, bottom: 0, right: -(GAP + HEAD) / 2, width: HEAD, alignItems: 'center' },
  headKnob: { width: 10, height: 10, borderRadius: 5 },
  headLine: { width: 2, flex: 1, borderRadius: 1 },
  caption: { paddingHorizontal: space.md },
});
