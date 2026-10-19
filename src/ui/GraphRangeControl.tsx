import { View } from 'react-native';

import type { GraphInfo } from '@/imaging/smartCrop';
import type { GraphRange } from '@/state/useImageConversion';
import { Label, SegmentedControl } from './components';
import { settingStyles } from './SettingRows';
import { space } from './theme';

const GRAPH_RANGES: { value: GraphRange; label: string }[] = [
  { value: '2', label: '±2' },
  { value: '5', label: '±5' },
  { value: '10', label: '±10' },
  { value: 'whole', label: 'Whole' },
];

/** A graph value for display, to a tenth of the graph's numbered step (2 -> 0.2: one decimal), with a real minus sign. */
export const graphNumber = (v: number, unitsPerMajor: number) => {
  const decimals = Math.max(0, Math.min(6, Math.ceil(-Math.log10(unitsPerMajor / 10) - 1e-9)));
  const r = Number(v.toFixed(decimals));
  return String(Object.is(r, -0) ? 0 : r).replace('-', '−');
};

/** What the pins show of a graph: ± units around the curve's vertex or middle, or the whole curve. */
export function GraphRangeControl({
  graph,
  range,
  onChange,
  readingNumbers,
}: {
  graph: GraphInfo;
  range: GraphRange;
  onChange: (range: GraphRange) => void;
  /** The axis numbers are still being read (the whole curve shows meanwhile). */
  readingNumbers: boolean;
}) {
  const { window: win, scale, axes } = graph;
  const shown =
    range === 'whole'
      ? 'Whole curve'
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
      <SegmentedControl
        options={GRAPH_RANGES}
        value={range}
        onChange={onChange}
        accessibilityLabel="Graph range: units shown each side of the curve's vertex or middle"
      />
      {range !== 'whole' && scale ? (
        <>
          {graph.fit === 'grown' ? (
            <Label variant="footnote" secondary>
              The graph is zoomed out too far to show ±{range} clearly. Zoom in on it to see less.
            </Label>
          ) : graph.fit === 'shrunk' ? (
            <Label variant="footnote" secondary>
              The graph shows less than ±{range}. Zoom out on it to see more.
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
