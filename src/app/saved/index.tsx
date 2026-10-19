import { router } from 'expo-router';
import { useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Platform, StyleSheet, View } from 'react-native';

import { GRID } from '@/config/hardware';
import { countRaised, fitPatternToGrid, patternsEqual } from '@/domain/pattern';
import { usePattern } from '@/state/PatternProvider';
import { patternStore, useSavedPatterns } from '@/state/useSavedPatterns';
import { canPickFile, pickPatternFile, savePatternFile } from '@/storage/patternFile';
import { exportFileName, exportPatterns, isCompatible, parseExport, type SavedPattern, toPattern } from '@/storage/patternStore';
import { Button, Label, Screen, Section, Separator, StatusBanner } from '@/ui/components';
import { confirmAsync } from '@/ui/dialogs';
import { useResponsive } from '@/ui/layout';
import { Icon } from '@/ui/Icon';
import { ImportPasteSheet } from '@/ui/ImportPasteSheet';
import { PinGrid } from '@/ui/PinGrid';
import { radius, space, useTheme } from '@/ui/theme';

/** "3 patterns", "1 pattern". */
const count = (n: number) => `${n} pattern${n === 1 ? '' : 's'}`;

export default function SavedScreen() {
  const t = useTheme();
  const { patterns, skipped, loading, error, reload } = useSavedPatterns();
  const { pattern: current, setPattern } = usePattern();
  const { twoColumn, width } = useResponsive();
  const columns = width >= 1280 ? 3 : 2;
  /** The last export or import, reported under the buttons. */
  const [transfer, setTransfer] = useState<{ tone: 'success' | 'warning' | 'error'; title: string; message?: string } | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);

  const report = (r: NonNullable<typeof transfer>) => {
    setTransfer(r);
    AccessibilityInfo.announceForAccessibility(r.message ? `${r.title}. ${r.message}` : r.title);
  };

  const exportAll = async () => {
    try {
      const shared = await savePatternFile(exportPatterns(patterns), exportFileName());
      if (shared) report({ tone: 'success', title: `Exported ${count(patterns.length)}`, message: 'Keep the file to restore them or move them to another device.' });
    } catch (e) {
      report({ tone: 'error', title: 'Export failed', message: e instanceof Error ? e.message : String(e) });
    }
  };

  /** Reads an export and adds its patterns. Throws (for the paste sheet) when the text isn't an export. */
  const importText = async (text: string) => {
    const parsed = parseExport(text);
    const res = await patternStore.importPatterns(parsed.patterns);
    await reload();
    setPasteOpen(false);
    const notes = [
      res.renamed ? `${count(res.renamed)} renamed, because the name was taken` : '',
      res.duplicates ? `${count(res.duplicates)} already here` : '',
      parsed.skipped ? `${parsed.skipped} damaged record(s) skipped` : '',
    ].filter(Boolean);
    report({
      tone: res.added || res.duplicates ? 'success' : 'warning',
      title: res.added ? `Imported ${count(res.added)}` : res.duplicates ? 'Nothing new to import' : 'No patterns in that file',
      message: notes.length ? `${notes.join(' · ')}.` : undefined,
    });
  };

  const importAll = async () => {
    if (!canPickFile) {
      setPasteOpen(true);
      return;
    }
    try {
      const text = await pickPatternFile();
      if (text !== null) await importText(text);
    } catch (e) {
      report({ tone: 'error', title: 'Import failed', message: e instanceof Error ? e.message : String(e) });
    }
  };

  const transferTools = (
    <View style={{ gap: space.sm }}>
      <View style={styles.actions}>
        <Button
          title="Export"
          icon="export"
          variant="secondary"
          compact
          style={{ flex: 1 }}
          disabled={!patterns.length}
          onPress={exportAll}
          accessibilityLabel="Export all patterns"
          accessibilityHint={
            canPickFile ? 'Downloads a file with every saved pattern' : 'Shares the saved patterns as text you can keep or send'
          }
        />
        <Button
          title="Import"
          icon="import"
          variant="secondary"
          compact
          style={{ flex: 1 }}
          onPress={importAll}
          accessibilityLabel="Import patterns"
          accessibilityHint={
            canPickFile ? 'Adds the patterns from an exported file' : 'Adds the patterns from exported text you paste'
          }
        />
      </View>
      {transfer ? <StatusBanner tone={transfer.tone} title={transfer.title} message={transfer.message} /> : null}
    </View>
  );

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
              Save a pattern from the Image tab. It is stored on this {DEVICE_WORD} only. Have an export? Import it.
            </Label>
          </View>
          {transferTools}
        </Section>
      ) : (
        <>
          <Section
            title="Backup"
            footer={`Export keeps a copy of every pattern outside this ${DEVICE_WORD}; Import adds them back here or on another device. Nothing is replaced.`}
            padded
            style={twoColumn ? { maxWidth: 560 } : undefined}>
            {transferTools}
          </Section>
          {twoColumn ? (
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
          )}
        </>
      )}
      <ImportPasteSheet visible={pasteOpen} onClose={() => setPasteOpen(false)} onImport={importText} />
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
