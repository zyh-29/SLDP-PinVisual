import { memo, useState } from 'react';
import { type LayoutChangeEvent, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { countRaised, getPin, type Pattern } from '@/domain/pattern';
import { tapFeedback } from './components';
import { radius, useTheme } from './theme';

/** Interactive cells never shrink below this, so they stay easy to hit. The grid scrolls instead. */
const MIN_INTERACTIVE_CELL = 40;
const MAX_CELL = 80;

/** Plain-language description of a pattern, row by row, for screen readers. */
export function describePattern(p: Pattern): string {
  const raised = countRaised(p);
  if (raised === 0) return `All ${p.rows * p.cols} pins lowered.`;
  const rows: string[] = [];
  for (let r = 0; r < p.rows; r++) {
    const cols: number[] = [];
    for (let c = 0; c < p.cols; c++) if (getPin(p, r, c) === 1) cols.push(c + 1);
    if (cols.length === p.cols) rows.push(`row ${r + 1}: all raised`);
    else if (cols.length) rows.push(`row ${r + 1}: column${cols.length > 1 ? 's' : ''} ${cols.join(', ')}`);
  }
  return `${raised} of ${p.rows * p.cols} pins raised. ${rows.join('; ')}.`;
}

interface Props {
  pattern: Pattern;
  /** When provided the grid is editable. */
  onToggle?: (row: number, col: number) => void;
  /** Fixed cell size (thumbnails). Otherwise the grid fills the available width. */
  cellSize?: number;
  disabled?: boolean;
}

export function PinGrid({ pattern, onToggle, cellSize, disabled }: Props) {
  const t = useTheme();
  const [width, setWidth] = useState(0);
  const interactive = !!onToggle;

  const fitted = width > 0 ? Math.floor(width / pattern.cols) : 0;
  const cell = cellSize ?? Math.min(MAX_CELL, interactive ? Math.max(MIN_INTERACTIVE_CELL, fitted) : fitted);
  const needsScroll = !cellSize && cell * pattern.cols > width + 0.5;

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const grid =
    cell > 0 ? (
      <View
        style={{ width: cell * pattern.cols }}
        accessible={!interactive}
        accessibilityRole={interactive ? undefined : 'image'}
        accessibilityLabel={interactive ? undefined : `Pin preview, ${pattern.rows} rows by ${pattern.cols} columns. ${describePattern(pattern)}`}>
        {Array.from({ length: pattern.rows }, (_, r) => (
          <View key={r} style={styles.row}>
            {Array.from({ length: pattern.cols }, (_, c) => (
              <PinCell
                key={c}
                row={r}
                col={c}
                raised={getPin(pattern, r, c) === 1}
                size={cell}
                onToggle={onToggle}
                disabled={disabled}
                colors={t}
              />
            ))}
          </View>
        ))}
      </View>
    ) : null;

  return (
    <View
      onLayout={cellSize ? undefined : onLayout}
      style={[styles.well, { backgroundColor: t.gridWell }, cellSize ? styles.wellCompact : null]}>
      {needsScroll ? (
        <ScrollView horizontal showsHorizontalScrollIndicator accessibilityHint="Scroll sideways to see all columns">
          {grid}
        </ScrollView>
      ) : (
        <View style={{ alignItems: 'center' }}>{grid}</View>
      )}
    </View>
  );
}

/**
 * One pin as the grid draws it, in a cell `size` across: raised is a solid dome with a highlight, lowered a hollow
 * ring (the shape differs, not just the colour). Also used on its own (the Pin Test tab).
 */
export function PinDot({ raised, size, colors }: { raised: boolean; size: number; colors: ReturnType<typeof useTheme> }) {
  const d = Math.round(size * 0.74);
  const border = Math.max(1.5, size / 20);
  return (
    <View
      style={{
        width: d,
        height: d,
        borderRadius: d / 2,
        backgroundColor: raised ? colors.pinRaised : colors.pinLoweredFill,
        borderWidth: raised ? 0 : border,
        borderColor: colors.pinLoweredBorder,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      {raised && d >= 14 ? (
        <View
          style={{
            width: d * 0.3,
            height: d * 0.3,
            borderRadius: d,
            backgroundColor: colors.pinLoweredFill,
            opacity: 0.35,
            transform: [{ translateX: -d * 0.12 }, { translateY: -d * 0.12 }],
          }}
        />
      ) : null}
    </View>
  );
}

const PinCell = memo(function PinCell({
  row,
  col,
  raised,
  size,
  onToggle,
  disabled,
  colors,
}: {
  row: number;
  col: number;
  raised: boolean;
  size: number;
  onToggle?: (row: number, col: number) => void;
  disabled?: boolean;
  colors: ReturnType<typeof useTheme>;
}) {
  const pin = <PinDot raised={raised} size={size} colors={colors} />;

  if (!onToggle) {
    return <View style={[styles.cell, { width: size, height: size }]}>{pin}</View>;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Row ${row + 1}, column ${col + 1}`}
      accessibilityValue={{ text: raised ? 'raised' : 'lowered' }}
      accessibilityState={{ checked: raised, disabled: !!disabled }}
      accessibilityHint={raised ? 'Double tap to lower this pin in the preview.' : 'Double tap to raise this pin in the preview.'}
      disabled={disabled}
      hitSlop={0}
      onPress={() => {
        tapFeedback();
        onToggle(row, col);
      }}
      style={({ pressed }) => [styles.cell, { width: size, height: size, opacity: pressed ? 0.6 : 1 }]}>
      {pin}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  well: { borderRadius: radius.md, paddingVertical: 6 },
  wellCompact: { padding: 4, borderRadius: radius.sm, alignSelf: 'flex-start' },
  row: { flexDirection: 'row' },
  cell: { alignItems: 'center', justifyContent: 'center' },
});
