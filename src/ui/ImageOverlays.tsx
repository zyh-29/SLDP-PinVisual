import { StyleSheet, View } from 'react-native';

import { Label } from './components';
import { Icon } from './Icon';
import { radius, space, useTheme } from './theme';

/**
 * A red "Live" badge for the crop picture during a screen share or camera: "Focusing…" while the camera
 * refocuses, "Locked" while the camera follows one item.
 */
export function LiveBadge({ focusing = false, locked = false }: { focusing?: boolean; locked?: boolean }) {
  const label = focusing ? 'Focusing…' : locked ? 'Live · Locked' : 'Live';
  return (
    <View style={styles.liveBadge} accessible accessibilityLabel={focusing ? 'Live, focusing' : locked ? 'Live, locked on an item' : 'Live'}>
      <View style={[styles.liveDot, focusing && { backgroundColor: '#FFCC00' }]} />
      <Label variant="caption" style={{ color: '#FFFFFF', fontWeight: '600' }}>
        {label}
      </Label>
    </View>
  );
}

/** Shown while an image file is dragged over the page (web). */
export function DropOverlay() {
  const t = useTheme();
  return (
    <View pointerEvents="none" style={[styles.dropOverlay, { backgroundColor: t.background }]}>
      <View style={[styles.dropZone, { borderColor: t.tint, backgroundColor: t.tintSoft }]}>
        <Icon name="photo" color={t.tint} size={40} />
        <Label variant="title3" style={{ color: t.tint }}>
          Drop Image
        </Label>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF3B30' },
  dropOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    padding: space.lg,
  },
  dropZone: {
    flex: 1,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
});
