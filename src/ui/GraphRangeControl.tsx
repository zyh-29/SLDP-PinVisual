import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, TextInput, View } from 'react-native';

import { type GraphRange, graphRangeLabel, graphRangeText, panStep, parseGraphRange, sameGraphRange } from '@/imaging/graphRange';
import { describeGraph, graphNumber } from '@/imaging/graphSummary';
import type { GraphInfo } from '@/imaging/smartCrop';
import { Button, Label } from './components';
import { settingStyles } from './SettingRows';
import { radius, space, type, useTheme } from './theme';

/**
 * A typed range is applied this long after the last keystroke (or at once on Enter, or when leaving the field):
 * typing "10" shouldn't show ±1 on the pins on the way.
 */
const APPLY_AFTER_MS = 500;

/**
 * Keyboards with + and − on them: phones' number pads have neither, and no keyboard has ±. iOS has a keyboard of
 * digits and punctuation; elsewhere the ordinary keyboard (Android's number pads vary by maker).
 */
const KEYBOARD = Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default';

/** What a range does, in words, under the field. */
function meaning(r: GraphRange): string {
  if (r.kind === 'auto') return 'Auto: the whole curve, or the part where it turns and bends.';
  if (r.kind === 'whole') return 'The whole curve.';
  const n = r.units;
  const units = `${n} unit${n === 1 ? '' : 's'}`;
  return r.side === 'both'
    ? `${units} each side of the middle of the graph.`
    : `${units} to the ${r.side} of the middle of the graph.`;
}

/** What the pins show of a graph: typed as ± units around the middle of the graph (or one side), Auto, or the whole curve; and moving it. */
export function GraphRangeControl({
  graph,
  range,
  onChange,
  readingNumbers,
  pan,
  onPan,
  live,
}: {
  graph: GraphInfo;
  range: GraphRange;
  onChange: (range: GraphRange) => void;
  /** The axis numbers are still being read (the whole curve shows meanwhile). */
  readingNumbers: boolean;
  /** How far the window was moved (units, right and up). */
  pan: { x: number; y: number };
  onPan: (pan: { x: number; y: number }) => void;
  /** A live share or camera: the summary changes all the time, so it isn't announced by itself. */
  live?: boolean;
}) {
  const t = useTheme();
  const [text, setText] = useState(() => graphRangeText(range));
  const [editing, setEditing] = useState(false);
  // The range changed from outside (a reset): show it, unless the user is typing (React's "adjust state while
  // rendering" pattern).
  const [shownRange, setShownRange] = useState(range);
  if (!sameGraphRange(shownRange, range)) {
    setShownRange(range);
    if (!editing) setText(graphRangeText(range));
  }
  const parsed = parseGraphRange(text);
  const typed = 'range' in parsed ? parsed.range : null;

  // The latest callback, so a parent re-rendering (a live share does, several times a second) doesn't restart the
  // timer below.
  const latest = useRef({ onChange, range });
  useEffect(() => {
    latest.current = { onChange, range };
  });
  /** Applies a range, when it means something new ("5" and "±5.0" are the same: nothing to redo). */
  const apply = (r: GraphRange | null) => {
    if (r && !sameGraphRange(r, latest.current.range)) latest.current.onChange(r);
  };
  // Applied after a pause in typing. Keyed by what the text means, not the text or the objects.
  const typedKey = typed ? graphRangeText(typed) : null;
  useEffect(() => {
    if (typedKey === null) return;
    const timer = setTimeout(() => {
      const r = parseGraphRange(typedKey);
      if ('range' in r && !sameGraphRange(r.range, latest.current.range)) latest.current.onChange(r.range);
    }, APPLY_AFTER_MS);
    return () => clearTimeout(timer);
  }, [typedKey]);

  const wholeCurve = range.kind !== 'window';
  const step = range.kind === 'window' ? panStep(range) : 1;
  const move = (dx: number, dy: number) => onPan({ x: pan.x + dx * step, y: pan.y + dy * step });
  const moved = pan.x !== 0 || pan.y !== 0;
  const { window: win, scale, axes, waves, features } = graph;
  /** ", x from −2 to 2" when the scale is known. */
  const span = (r: { x: number; width: number }) =>
    scale && axes.originX !== null
      ? `, x from ${graphNumber((r.x - axes.originX) / scale.pxPerUnitX, scale.unitsPerMajorX)} to ${graphNumber(
          (r.x + r.width - axes.originX) / scale.pxPerUnitX,
          scale.unitsPerMajorX,
        )}`
      : '';
  // More waves than the pins can show: say how many are shown, and how to see the rest.
  const wavesNote =
    wholeCurve && waves
      ? `The curve has ${waves.total} waves, more than the pins can show clearly: the middle ${waves.shown === 1 ? 'one is' : `${waves.shown} are`} shown. Type a range, like 3, to look along it.`
      : null;
  // Auto showing part of the curve: why, and how to see all of it.
  const featuresNote =
    range.kind === 'auto' && features
      ? `Shown where the curve turns and bends${span(features)}: the whole curve would squash them flat. Type whole to feel all of it.`
      : null;
  const summary = wavesNote ?? featuresNote ?? (!readingNumbers && !wholeCurve ? describeGraph(graph) : null);
  const shown = wholeCurve
    ? waves
      ? `${waves.shown} of ${waves.total} waves`
      : features
        ? 'Turns and bends'
        : 'Whole curve'
    : readingNumbers
      ? 'Reading numbers…'
      : win && scale && axes.originX !== null
        ? `x ${graphNumber((win.x - axes.originX) / scale.pxPerUnitX, scale.unitsPerMajorX)} to ${graphNumber(
            (win.x + win.width - axes.originX) / scale.pxPerUnitX,
            scale.unitsPerMajorX,
          )}`
        : graphRangeLabel(range);
  return (
    <View style={{ gap: space.sm }}>
      <View style={settingStyles.header}>
        <Label variant="body">Graph Range</Label>
        <Label variant="body" secondary numberOfLines={1} style={{ flexShrink: 1, textAlign: 'right' }}>
          {shown}
        </Label>
      </View>
      {summary ? (
        <Label variant="footnote" secondary accessibilityLiveRegion={live ? 'none' : 'polite'}>
          {summary}
        </Label>
      ) : null}
      <TextInput
        value={text}
        onChangeText={setText}
        onFocus={() => setEditing(true)}
        onBlur={() => {
          setEditing(false);
          apply(typed);
        }}
        onSubmitEditing={() => apply(typed)}
        placeholder="Auto: or type 5, +5, -5"
        placeholderTextColor={t.textSecondary}
        keyboardType={KEYBOARD}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="done"
        accessibilityLabel="Graph range"
        accessibilityHint="Type 5 for 5 units each side of the middle of the graph, +5 for the right side only, -5 for the left side only. Leave it empty for Auto, or type whole."
        style={[type.body, styles.input, { color: t.text, backgroundColor: t.fill, borderColor: typed ? 'transparent' : t.destructive }]}
      />
      <Label
        variant="footnote"
        secondary={!!typed}
        style={typed ? undefined : { color: t.destructive }}
        accessibilityLiveRegion="polite">
        {'error' in parsed ? parsed.error : meaning(typed!)}
      </Label>
      {!wholeCurve && scale && win ? (
        <View style={styles.pad} accessibilityLabel="Move the graph window">
          <Button title="" icon="left" variant="secondary" compact style={styles.arrow} onPress={() => move(-1, 0)} accessibilityLabel={`Move left ${step}`} />
          <Button title="" icon="up" variant="secondary" compact style={styles.arrow} onPress={() => move(0, 1)} accessibilityLabel={`Move up ${step}`} />
          <Button title="" icon="down" variant="secondary" compact style={styles.arrow} onPress={() => move(0, -1)} accessibilityLabel={`Move down ${step}`} />
          <Button title="" icon="right" variant="secondary" compact style={styles.arrow} onPress={() => move(1, 0)} accessibilityLabel={`Move right ${step}`} />
          <Button
            title="Centre"
            icon="centre"
            variant="secondary"
            compact
            disabled={!moved}
            style={styles.centre}
            onPress={() => onPan({ x: 0, y: 0 })}
            accessibilityHint="Puts the window back on the middle of the graph"
          />
        </View>
      ) : null}
      {!wholeCurve && scale ? (
        <>
          {graph.fit === 'grown' ? (
            <Label variant="footnote" secondary>
              The graph is zoomed out too far to show {graphRangeLabel(range)} clearly. Zoom in on it to see less.
            </Label>
          ) : graph.fit === 'shrunk' ? (
            <Label variant="footnote" secondary>
              Zoomed in past {graphRangeLabel(range)}: the curve keeps its size on the pins, and the part off the screen stays down. Zoom out on it to see all of it.
            </Label>
          ) : null}
          {scale.from === 'grid' ? (
            <Label variant="footnote" secondary>
              Axis numbers not readable: one grid square counts as one unit.
            </Label>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  input: { minHeight: 50, paddingHorizontal: space.md, borderRadius: radius.sm, borderWidth: 1.5 },
  pad: { flexDirection: 'row', gap: space.sm },
  arrow: { flex: 1, minWidth: 44 },
  centre: { flexGrow: 1.6, flexShrink: 1 },
});
