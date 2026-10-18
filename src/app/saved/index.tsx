import { router } from 'expo-router';
import { AccessibilityInfo, ActivityIndicator, Platform, StyleSheet, View } from 'react-native';

import { GRID } from '@/config/hardware';
import { countRaised, fitPatternToGrid, patternsEqual } from '@/domain/pattern';
import { usePattern } from '@/state/PatternProvider';
import { patternStore, useSavedPatterns } from '@/state/useSavedPatterns';
import { isCompatible, type SavedPattern, toPattern } from '@/storage/patternStore';
import { Button, Label, Screen, Section, Separator, StatusBanner } from '@/ui/components';
import { confirmAsync } from '@/ui/dialogs';
import { useResponsive } from '@/ui/layout';
import { Icon } from '@/ui/Icon';
import { PinGrid } from '@/ui/PinGrid';
import { radius, space, useTheme } from '@/ui/theme';

export default function SavedScreen() {
  const t = useTheme();
  const { patterns, skipped, loading, error, reload } = useSavedPatterns();
  const { pattern: current, setPattern } = usePattern();
  const { twoColumn, width } = useResponsive();
  const columns = width >= 1280 ? 3 : 2;

  const load = (saved: SavedPattern, adapt = false) => {
    const p = toPattern(saved);
    if (!p) return;
    setPattern(adapt ? fitPatternToGrid(p, GRID.rows, GRID.cols) : p, saved.name);
    AccessibilityInfo.announceForAccessibility(`Loaded ${saved.name} into the preview`);
    router.navigate('/');
  };

  const loadIncompatible = async (saved: SavedPattern) => {
    const ok = await confirmAsync({
      title: 'Different grid size',
      message: `"${saved.name}" was made for a ${saved.rows} × ${saved.cols} grid. This display is ${GRID.rows} × ${GRID.cols}.\n\nFit it by cropping or padding equally on each side? The saved copy is not changed.`,
      confirmLabel: 'Fit to Grid',
    });
    if (ok) load(saved, true);
  };

  const remove = async (saved: SavedPattern) => {
    const ok = await confirmAsync({
      title: 'Delete pattern?',
      message: `"${saved.name}" will be removed from this ${DEVICE_WORD}.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    await patternStore.remove(saved.id);
    await reload();
    AccessibilityInfo.announceForAccessibility(`Deleted ${saved.name}`);
  };

  const renderItem = (saved: SavedPattern) => {
    const p = toPattern(saved);
    const compatible = isCompatible(saved, GRID.rows, GRID.cols);
    const isCurrent = !!p && compatible && patternsEqual(p, current);
    const date = new Date(saved.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return (
      <View style={styles.item}>
        <View style={styles.itemTop}>
          {p ? <PinGrid pattern={p} cellSize={Math.max(6, Math.min(11, Math.floor(96 / p.cols)))} /> : null}
          <View style={{ flex: 1, gap: 2 }}>
            <Label variant="headline" numberOfLines={2}>
              {saved.name}
            </Label>
            <Label variant="footnote" secondary>
              {saved.rows} × {saved.cols} · {p ? countRaised(p) : 0} raised · {date}
            </Label>
            {!compatible ? (
              <View style={[styles.badge, { backgroundColor: t.warningSoft }]}>
                <Icon name="error" color={t.warning} size={13} />
                <Label variant="caption" style={{ color: t.warning, fontWeight: '600' }}>
                  Different grid size
                </Label>
              </View>
            ) : isCurrent ? (
              <Label variant="caption" secondary>
                Matches the current preview
              </Label>
            ) : null}
          </View>
        </View>
        <View style={styles.actions}>
          <Button
            title={compatible ? 'Load' : 'Fit & Load…'}
            variant="secondary"
            compact
            style={{ flex: 1 }}
            accessibilityLabel={compatible ? `Load ${saved.name}` : `Fit and load ${saved.name}, made for a ${saved.rows} by ${saved.cols} grid`}
            accessibilityHint="Replaces the preview on the Display tab. Nothing is sent to the board."
            onPress={() => (compatible ? load(saved) : loadIncompatible(saved))}
          />
          <Button
            title="Delete"
            variant="destructive"
            compact
            icon="trash"
            style={{ flex: 1 }}
            accessibilityLabel={`Delete ${saved.name}`}
            onPress={() => remove(saved)}
          />
        </View>
      </View>
    );
  };

  return (
    <Screen title="Saved">
      {error ? <StatusBanner tone="error" title="Could not read saved patterns" message={error} /> : null}
      {skipped > 0 ? (
        <StatusBanner tone="warning" title="Some saved data was unreadable" message={`${skipped} damaged record(s) were skipped.`} />
      ) : null}

      {loading ? (
        <ActivityIndicator accessibilityLabel="Loading saved patterns" />
      ) : patterns.length === 0 ? (
        <Section padded style={{ maxWidth: 560, width: '100%', alignSelf: 'center' }}>
          <View style={styles.empty}>
            <View style={[styles.emptyIcon, { backgroundColor: t.tintSoft }]}>
              <Icon name="save" color={t.tint} size={28} />
            </View>
            <Label variant="title3">No saved patterns</Label>
            <Label variant="subhead" secondary style={{ textAlign: 'center' }}>
              Save a pattern from the Image tab. It is stored on this {DEVICE_WORD} only.
            </Label>
          </View>
        </Section>
      ) : (
        twoColumn ? (
          <View style={{ gap: space.sm }}>
            <Label variant="footnote" secondary accessibilityRole="header" style={styles.groupTitle}>
              {`ON THIS ${DEVICE_WORD.toUpperCase()} · ${patterns.length}`}
            </Label>
            <View style={styles.cardGrid}>
              {patterns.map((saved) => (
                <View key={saved.id} style={[styles.card, { backgroundColor: t.card, width: columns === 3 ? '31.9%' : '48.9%' }]}>
                  {renderItem(saved)}
                </View>
              ))}
            </View>
          </View>
        ) : (
          <Section title={`On this ${DEVICE_WORD} · ${patterns.length}`} padded={false}>
            {patterns.map((saved, i) => (
              <View key={saved.id}>
                {i > 0 ? <Separator inset={space.lg} /> : null}
                {renderItem(saved)}
              </View>
            ))}
          </Section>
        )
      )}
    </Screen>
  );
}

/** Saved patterns live in this browser's storage on web, on the phone otherwise. */
const DEVICE_WORD = Platform.OS === 'web' ? 'browser' : 'phone';

const styles = StyleSheet.create({
  groupTitle: { marginLeft: space.lg, fontWeight: '500' },
  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg },
  card: { borderRadius: radius.lg, overflow: 'hidden' },
  empty: { alignItems: 'center', gap: space.sm, paddingVertical: space.lg },
  emptyIcon: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', marginBottom: space.sm },
  item: { padding: space.lg, gap: space.md },
  itemTop: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
  actions: { flexDirection: 'row', gap: space.md },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    marginTop: 2,
  },
});
