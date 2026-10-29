import { memo, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';

import type { Pattern } from '@/domain/pattern';
import { describeStep, MAX_UNDO, type Preview, type StepKind } from '@/state/previewHistory';
import { Label, tapFeedback } from './components';
import { confirmAsync } from './dialogs';
import { Icon, type IconName } from './Icon';
import { MIN_TOUCH, radius, space, type Palette, useTheme } from './theme';
import {
  edgeSpeed,
  GAP,
  headX,
  PAD_BOTTOM,
  PAD_TOP,
  PAD_X,
  stepAt,
  TICK_ZONE,
  TILE_H,
  TILE_W,
  TRACK,
  TRACK_BOTTOM,
} from './timelineGeometry';

/** The step arrows: Material's triangles fill less of their box than SF Symbols' do. */
const STEP_ICON = Platform.OS === 'ios' ? 17 : 28;
/** Side by side (transport, then the strip) from this width; stacked below it (phones). */
const WIDE = 520;
/**
 * Web: while the playhead is dragged, the mouse sweeps over the page, and the browser would select the text it
 * passes. Selection is turned off for the whole page until the drag ends (and anything already selected cleared).
 */
const pageSelection = (on: boolean) => {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  const style = document.body.style as CSSStyleDeclaration & { webkitUserSelect?: string };
  style.userSelect = on ? '' : 'none';
  style.webkitUserSelect = on ? '' : 'none';
  if (!on) window.getSelection()?.removeAllRanges();
};

const stopEdgeScroll = (l: { timer: ReturnType<typeof setInterval> | null }) => {
  if (l.timer) clearInterval(l.timer);
  l.timer = null;
};

const NATIVE_DRIVER = Platform.OS !== 'web';
const isMac = Platform.OS === 'web' && typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);

const KIND_ICON: Record<StepKind, IconName> = {
  start: 'grid',
  source: 'bookmarks',
  clear: 'clear',
  raise: 'up',
  lower: 'down',
  edit: 'edit',
};

/**
 * The preview's history as a timeline, like Fusion 360's: every step in order, the playhead after the one showing,
 * undone steps faded beyond it. Tap a step, or drag the playhead, to go there; the buttons go to the start, back
 * one, forward one and to the latest. Never moves the physical pins.
 */
export function HistoryTimeline({
  steps,
  position,
  onJump,
  onClear,
}: {
  steps: Preview[];
  position: number;
  onJump: (index: number) => void;
  /** Forget every other step (after asking); the preview showing stays. */
  onClear: () => void;
}) {
  const t = useTheme();
  const [width, setWidth] = useState(0);
  const [viewport, setViewport] = useState(0);
  const [dragging, setDragging] = useState(false);
  const scroll = useRef<ScrollViewInstance>(null);
  const last = steps.length - 1;
  const trimmed = steps.length > MAX_UNDO;
  const describe = (i: number) => describeStep(steps[i - 1], steps[i], trimmed);
  const now = describe(position);

  const announce = (i: number) =>
    AccessibilityInfo.announceForAccessibility(`Step ${i + 1} of ${steps.length}: ${describe(i).text}`);
  const jump = (i: number) => {
    const to = Math.max(0, Math.min(last, i));
    if (to === position) return;
    tapFeedback();
    onJump(to);
    announce(to);
  };

  // The playhead glides to its new place.
  const [x] = useState(() => new Animated.Value(headX(position)));
  useEffect(() => {
    Animated.spring(x, { toValue: headX(position), useNativeDriver: NATIVE_DRIVER, speed: 40, bounciness: 0 }).start();
  }, [position, x]);

  // Keep the playhead in view (centred when it can be), except while it's being dragged.
  useEffect(() => {
    if (!viewport || dragging) return;
    scroll.current?.scrollTo({ x: Math.max(0, headX(position) - viewport / 2), animated: true });
  }, [position, steps.length, viewport, dragging]);

  // Dragging the playhead: it follows the finger, snapping from step to step with a tick of haptics at each. Held
  // near either end of the strip, the strip scrolls on its own (faster nearer the edge) and the playhead goes with
  // it, so every step can be reached, however long the history.
  const live = useRef({
    position,
    last,
    onJump,
    announce,
    viewport,
    /** How far the strip is scrolled, and how wide its content is. */
    scrollX: 0,
    contentW: 0,
    /** Where the finger is, across the strip's visible part. */
    finger: 0,
    timer: null as ReturnType<typeof setInterval> | null,
  });
  useEffect(() => {
    Object.assign(live.current, { position, last, onJump, announce, viewport });
  });
  useEffect(
    () => () => {
      stopEdgeScroll(live.current);
      pageSelection(true);
    },
    [],
  );
  // The ref is read only inside the gesture callbacks, never while rendering.
  // eslint-disable-next-line react-hooks/refs
  const [pan] = useState(() => {
    let fingerStart = 0;
    /** The step under the finger. */
    const follow = () => {
      const l = live.current;
      const to = stepAt(l.finger + l.scrollX, l.last);
      if (to === l.position) return;
      l.position = to;
      tapFeedback();
      l.onJump(to);
    };
    const edgeScroll = () => {
      const l = live.current;
      const speed = edgeSpeed(l.finger, l.viewport);
      if (!speed) return;
      const next = Math.max(0, Math.min(Math.max(0, l.contentW - l.viewport), l.scrollX + speed));
      if (next === l.scrollX) return;
      l.scrollX = next;
      scroll.current?.scrollTo({ x: next, animated: false });
      follow();
    };
    const end = () => {
      stopEdgeScroll(live.current);
      pageSelection(true);
      setDragging(false);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        pageSelection(false);
        const l = live.current;
        // The finger starts on the playhead.
        fingerStart = headX(l.position) - l.scrollX;
        l.finger = fingerStart;
        stopEdgeScroll(l);
        l.timer = setInterval(edgeScroll, 16);
        setDragging(true);
      },
      onPanResponderMove: (_, g) => {
        live.current.finger = fingerStart + g.dx;
        follow();
      },
      onPanResponderRelease: () => {
        end();
        live.current.announce(live.current.position);
      },
      onPanResponderTerminate: end,
    });
  });

  const clear = async () => {
    const ok = await confirmAsync({
      title: 'Clear history?',
      message: `Removes all ${steps.length - 1} other step${steps.length === 2 ? '' : 's'}, undone ones too. The preview stays as it is. This can't be undone.`,
      confirmLabel: 'Clear History',
      icon: 'trash',
      destructive: true,
    });
    if (!ok) return;
    onClear();
    AccessibilityInfo.announceForAccessibility('History cleared');
  };

  const transport = (
    <View style={styles.transport}>
      <Transport icon="previous" label="Back to start" disabled={position === 0} onPress={() => jump(0)} colors={t} />
      <Transport icon="stepBack" label="Undo" disabled={position === 0} onPress={() => jump(position - 1)} colors={t} />
      <Transport icon="stepForward" label="Redo" disabled={position === last} onPress={() => jump(position + 1)} colors={t} />
      <Transport icon="next" label="Forward to latest" disabled={position === last} onPress={() => jump(last)} colors={t} />
      <View style={[styles.transportDivider, { backgroundColor: t.separator }]} />
      <Transport
        icon="trash"
        label="Clear history"
        hint="Removes every step except the one showing. The preview stays as it is."
        destructive
        disabled={last === 0}
        onPress={clear}
        colors={t}
      />
    </View>
  );

  const strip = (
    <ScrollView
      ref={scroll}
      horizontal
      scrollEnabled={!dragging}
      showsHorizontalScrollIndicator={false}
      scrollEventThrottle={16}
      onScroll={(e) => {
        live.current.scrollX = e.nativeEvent.contentOffset.x;
      }}
      onContentSizeChange={(w) => {
        live.current.contentW = w;
      }}
      onLayout={(e) => setViewport(e.nativeEvent.layout.width)}
      style={styles.stripView}
      contentContainerStyle={styles.strip}>
      {/* The track, under every step and on to the edge; the part up to the playhead is drawn stronger. */}
      <View style={[styles.track, { backgroundColor: t.separator }]} />
      <View style={[styles.track, styles.trackDone, { width: headX(position) - PAD_X, backgroundColor: t.textSecondary }]} />
      {steps.map((s, i) => (
        <View key={i} style={styles.slot}>
          <Step
            pattern={s.pattern}
            index={i}
            count={steps.length}
            text={describe(i).text}
            current={i === position}
            undone={i > position}
            onPress={jump}
            colors={t}
          />
          <View style={[styles.tick, { backgroundColor: i <= position ? t.textSecondary : t.separator }]} />
        </View>
      ))}
      <Animated.View
        {...pan.panHandlers}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Playhead"
        accessibilityValue={{ text: `Step ${position + 1} of ${steps.length}, ${now.text}` }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => jump(position + (e.nativeEvent.actionName === 'increment' ? 1 : -1))}
        style={[styles.headHit, Platform.OS === 'web' ? ({ cursor: dragging ? 'grabbing' : 'grab' } as unknown as ViewStyle) : null, { transform: [{ translateX: x }] }]}>
        <View style={[styles.headLine, { backgroundColor: t.tint }]} />
        <View style={[styles.headKnob, { backgroundColor: t.tint, borderColor: t.gridWell, transform: [{ scale: dragging ? 1.3 : 1 }] }]} />
      </Animated.View>
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
      <View style={styles.captionRow}>
        <Icon name={now.kind === 'source' && now.text === 'From image' ? 'photo' : KIND_ICON[now.kind]} color={t.textSecondary} size={14} />
        <Label variant="footnote" secondary style={{ flex: 1 }} accessibilityLiveRegion="polite">
          <Label variant="footnote" style={{ color: t.text, fontWeight: '600' }}>
            Step {position + 1} of {steps.length}
          </Label>
          {` · ${now.text}`}
          {undone ? ` · ${undone}\u00A0undone` : ''}
        </Label>
        {wide && Platform.OS === 'web' ? (
          <View style={styles.keys} accessible={false}>
            <Key text={isMac ? '⌘Z' : 'Ctrl+Z'} colors={t} />
            <Key text={isMac ? '⇧⌘Z' : 'Ctrl+Y'} colors={t} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

function Key({ text, colors: t }: { text: string; colors: Palette }) {
  return (
    <View style={[styles.key, { borderColor: t.separator }]}>
      <Label variant="caption" secondary>
        {text}
      </Label>
    </View>
  );
}

function Transport({
  icon,
  label,
  hint = 'Changes the preview only. Does not move the physical pins.',
  destructive,
  disabled,
  onPress,
  colors: t,
}: {
  icon: IconName;
  label: string;
  hint?: string;
  destructive?: boolean;
  disabled: boolean;
  onPress: () => void;
  colors: Palette;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.transportButton,
        {
          backgroundColor: pressed ? t.cardPressed : hovered && !disabled ? (destructive ? t.destructiveSoft : t.fill) : 'transparent',
          opacity: disabled ? 0.35 : 1,
        },
      ]}>
      <Icon name={icon} color={disabled ? t.textSecondary : destructive ? t.destructive : t.tint} size={icon === 'stepBack' || icon === 'stepForward' ? STEP_ICON : 20} />
    </Pressable>
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
          backgroundColor: current ? t.tintSoft : pressed || hovered ? t.cardPressed : t.card,
          borderColor: current ? t.tint : 'transparent',
          opacity: undone ? (hovered ? 0.7 : 0.4) : 1,
        },
      ]}>
      <MiniPins pattern={pattern} colors={t} />
    </Pressable>
  );
});

/** The pins at one step: raised are solid dots, lowered faint ones. */
function MiniPins({ pattern, colors: t }: { pattern: Pattern; colors: Palette }) {
  const dot = Math.max(2, Math.min(5, Math.floor(36 / Math.max(pattern.cols, pattern.rows + 1)) - 1));
  return (
    <View style={{ gap: 1.5 }}>
      {Array.from({ length: pattern.rows }, (_, r) => (
        <View key={r} style={{ flexDirection: 'row', gap: 1.5 }}>
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
                  opacity: raised ? 1 : 0.28,
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
  panel: { borderRadius: radius.md, paddingVertical: space.sm, gap: space.xs, userSelect: 'none' },
  wideRow: { flexDirection: 'row', alignItems: 'center' },
  narrowRow: { flexDirection: 'row', justifyContent: 'center' },
  divider: { width: StyleSheet.hairlineWidth, height: TILE_H },
  transport: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xs },
  transportDivider: { width: StyleSheet.hairlineWidth, height: 22, marginHorizontal: space.xs },
  transportButton: { width: MIN_TOUCH, height: MIN_TOUCH, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  stripView: { flex: 1, flexGrow: 1 },
  strip: { flexGrow: 1, flexDirection: 'row', gap: GAP, paddingHorizontal: PAD_X, paddingTop: PAD_TOP, paddingBottom: PAD_BOTTOM + TRACK },
  track: { position: 'absolute', left: PAD_X, right: PAD_X, top: TRACK_BOTTOM - TRACK, height: TRACK, borderRadius: TRACK / 2 },
  trackDone: { right: undefined },
  slot: { alignItems: 'center' },
  tile: { width: TILE_W, height: TILE_H, borderRadius: radius.sm + 2, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  tick: { width: 1.5, height: TICK_ZONE - 4, marginTop: 4, borderRadius: 1 },
  // The playhead's touch area: MIN_TOUCH wide, centred on its line (translateX moves the centre to headX).
  headHit: { position: 'absolute', left: -MIN_TOUCH / 2, top: 0, width: MIN_TOUCH, height: TRACK_BOTTOM + 4, alignItems: 'center', zIndex: 2 },
  headLine: { position: 'absolute', top: 6, height: TRACK_BOTTOM - 6, width: 2.5, borderRadius: 1.25 },
  headKnob: { position: 'absolute', top: 0, width: 14, height: 14, borderRadius: 7, borderWidth: 2.5 },
  captionRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm - 2, paddingHorizontal: space.md, minHeight: 22 },
  keys: { flexDirection: 'row', gap: space.xs },
  key: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1 },
});
