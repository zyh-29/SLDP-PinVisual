import { StyleSheet, View } from 'react-native';

import { describeGraph, graphNumber } from '@/imaging/graphSummary';
import type { GraphInfo } from '@/imaging/smartCrop';
import type { GraphRange } from '@/state/useImageConversion';
import { Button, Label, SegmentedControl } from './components';
import { settingStyles } from './SettingRows';
import { space } from './theme';

const GRAPH_RANGES: { value: GraphRange; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: '2', label: '±2' },
  { value: '5', label: '±5' },
  { value: '10', label: '±10' },
  { value: 'whole', label: 'Whole' },
];

/** How far one press of an arrow moves the window: a fifth of its width, in round units. */
export const panStep = (range: GraphRange) => (range === '2' ? 1 : range === '10' ? 4 : 2);

/** What the pins show of a graph: ± units around the curve's vertex or middle, or the whole curve; and moving it. */
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
  const step = panStep(range);
  /** ", x from −2 to 2" when the scale is known. */
  const span = (r: { x: number; width: number }) =>
    scale && axes.originX !== null
      ? `, x from ${graphNumber((r.x - axes.originX) / scale.pxPerUnitX, scale.unitsPerMajorX)} to ${graphNumber(
          (r.x + r.width - axes.originX) / scale.pxPerUnitX,
          scale.unitsPerMajorX,
        )}`
      : '';
  const move = (dx: number, dy: number) => onPan({ x: pan.x + dx * step, y: pan.y + dy * step });
  const moved = pan.x !== 0 || pan.y !== 0;
  const { window: win, scale, axes, waves, features } = graph;
  /** Whole and Auto show the curve as it is (or part of it), not a window in units. */
  const wholeCurve = range === 'whole' || range === 'auto';
  // More waves than the pins can show: say how many are shown, and how to see the rest.
  const wavesNote =
    wholeCurve && waves
      ? `The curve has ${waves.total} waves, more than the pins can show clearly: the middle ${waves.shown === 1 ? 'one is' : `${waves.shown} are`} shown. Pick ±2, ±5 or ±10 to look along it.`
      : null;
  // Auto showing part of the curve: why, and how to see all of it.
  const featuresNote =
    range === 'auto' && features
      ? `Shown where the curve turns and bends${span(features)}: the whole curve would squash them flat. Pick Whole to feel all of it.`
      : range === 'auto' && !waves
        ? 'Shown whole: nothing the whole curve would hide.'
        : null;
  const summary = wavesNote ?? featuresNote ?? (!readingNumbers && !wholeCurve ? describeGraph(graph) : null);
  const shown =
    wholeCurve
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
          : `±${range}`;
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
      <SegmentedControl
        options={GRAPH_RANGES}
        value={range}
        onChange={onChange}
        accessibilityLabel="Graph range: Auto, units shown each side of the curve's vertex or middle, or the whole curve"
      />
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
            accessibilityHint="Puts the window back on the curve's vertex or middle"
          />
        </View>
      ) : null}
      {!wholeCurve && scale ? (
        <>
          {graph.fit === 'grown' ? (
            <Label variant="footnote" secondary>
              The graph is zoomed out too far to show ±{range} clearly. Zoom in on it to see less.
            </Label>
          ) : graph.fit === 'shrunk' ? (
            <Label variant="footnote" secondary>
              Zoomed in past ±{range}: the curve keeps its size on the pins, and the part off the screen stays down. Zoom out on it to see all of it.
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
  pad: { flexDirection: 'row', gap: space.sm },
  arrow: { flex: 1, minWidth: 44 },
  centre: { flexGrow: 1.6, flexShrink: 1 },
});
