import { Image } from 'expo-image';
import { type ReactNode, useRef, useState } from 'react';
import { type GestureResponderEvent, type LayoutChangeEvent, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';

import { type CropDragMode as Mode, dragCrop, type Rect } from '@/imaging/foreground';
import { radius, useTheme } from './theme';

interface Props {
  /** The image to crop. Ignored when `backdrop` is given. */
  uri?: string;
  /** Drawn instead of the image, e.g. a live screen-share video. Must match imageWidth x imageHeight in aspect ratio. */
  backdrop?: ReactNode;
  /** Shown in the top-left corner, e.g. a Live badge. */
  badge?: ReactNode;
  /** Size of the coordinate space `crop` is in (the working raster). */
  imageWidth: number;
  imageHeight: number;
  crop: Rect;
  /** Called once when a drag ends. */
  onChange: (crop: Rect) => void;
  /** True while a handle is held, so the parent can stop scrolling. */
  onDragging?: (dragging: boolean) => void;
  maxHeight?: number;
}

const HANDLE_HIT = 44;
const HANDLE_DOT = 18;

export function CropEditor({ uri, backdrop, badge, imageWidth, imageHeight, crop, onChange, onDragging, maxHeight = 440 }: Props) {
  const t = useTheme();
  const [available, setAvailable] = useState(0);
  const [draft, setDraft] = useState<Rect | null>(null);

  const aspect = imageWidth / imageHeight;
  const dispW = available ? Math.min(available, maxHeight * aspect) : 0;
  const dispH = dispW / aspect;
  const k = dispW / imageWidth; // display points per image pixel

  // Drag state lives in a ref: it is only touched from touch handlers.
  const drag = useRef<{ startX: number; startY: number; from: Rect; current: Rect } | null>(null);

  const grant = (e: GestureResponderEvent) => {
    drag.current = { startX: e.nativeEvent.pageX, startY: e.nativeEvent.pageY, from: crop, current: crop };
    onDragging?.(true);
  };
  const move = (mode: Mode, e: GestureResponderEvent) => {
    const d = drag.current;
    if (!d || !k) return;
    const dx = (e.nativeEvent.pageX - d.startX) / k;
    const dy = (e.nativeEvent.pageY - d.startY) / k;
    d.current = dragCrop(d.from, mode, dx, dy, imageWidth, imageHeight);
    setDraft(d.current);
  };
  const finish = () => {
    const d = drag.current;
    drag.current = null;
    setDraft(null);
    onDragging?.(false);
    if (d) onChange(d.current);
  };

  const r = draft ?? crop;
  const box = { left: r.x * k, top: r.y * k, width: r.width * k, height: r.height * k };
  const shade = 'rgba(0,0,0,0.5)';

  return (
    <View onLayout={(e: LayoutChangeEvent) => setAvailable(e.nativeEvent.layout.width)} style={{ alignItems: 'center' }}>
      {dispW > 0 ? (
        <View
          style={[styles.stage, { width: dispW, height: dispH, backgroundColor: t.fill }]}
          accessible
          accessibilityRole="image"
          accessibilityLabel={`Selected image with crop box covering ${Math.round((r.width / imageWidth) * 100)}% of the width and ${Math.round((r.height / imageHeight) * 100)}% of the height. Use the crop buttons to change it.`}>
          {backdrop ?? <Image source={{ uri }} contentFit="fill" style={StyleSheet.absoluteFill} accessible={false} />}
          {/* Dimmed area outside the crop */}
          <View pointerEvents="none" style={[styles.abs, { left: 0, top: 0, width: dispW, height: box.top, backgroundColor: shade }]} />
          <View
            pointerEvents="none"
            style={[
              styles.abs,
              {
                left: 0,
                top: box.top + box.height,
                width: dispW,
                height: Math.max(0, dispH - box.top - box.height),
                backgroundColor: shade,
              },
            ]}
          />
          <View
            pointerEvents="none"
            style={[styles.abs, { left: 0, top: box.top, width: box.left, height: box.height, backgroundColor: shade }]}
          />
          <View
            pointerEvents="none"
            style={[
              styles.abs,
              {
                left: box.left + box.width,
                top: box.top,
                width: Math.max(0, dispW - box.left - box.width),
                height: box.height,
                backgroundColor: shade,
              },
            ]}
          />
          {/* Crop box: drag inside to move */}
          <DragZone onGrant={(e) => grant(e)} onMove={(e) => move('move', e)} onEnd={() => finish()} style={[styles.abs, styles.box, box]}>
            <View pointerEvents="none" style={[styles.third, { left: '33.33%', top: 0, bottom: 0, width: StyleSheet.hairlineWidth }]} />
            <View pointerEvents="none" style={[styles.third, { left: '66.66%', top: 0, bottom: 0, width: StyleSheet.hairlineWidth }]} />
            <View pointerEvents="none" style={[styles.third, { top: '33.33%', left: 0, right: 0, height: StyleSheet.hairlineWidth }]} />
            <View pointerEvents="none" style={[styles.third, { top: '66.66%', left: 0, right: 0, height: StyleSheet.hairlineWidth }]} />
          </DragZone>
          {/* Corner handles: drag to resize */}
          {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
            <DragZone
              key={c}
              onGrant={(e) => grant(e)}
              onMove={(e) => move(c, e)}
              onEnd={() => finish()}
              style={[
                styles.abs,
                styles.handle,
                {
                  left: (c[1] === 'l' ? box.left : box.left + box.width) - HANDLE_HIT / 2,
                  top: (c[0] === 't' ? box.top : box.top + box.height) - HANDLE_HIT / 2,
                },
              ]}>
              <View style={[styles.dot, { borderColor: t.tint }]} />
            </DragZone>
          ))}
          {badge ? (
            <View pointerEvents="none" style={styles.badge}>
              {badge}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** A view that owns a touch for the whole drag (the scroll view can't steal it). */
function DragZone({
  onGrant,
  onMove,
  onEnd,
  style,
  children,
}: {
  onGrant: (e: GestureResponderEvent) => void;
  onMove: (e: GestureResponderEvent) => void;
  onEnd: () => void;
  style: StyleProp<ViewStyle>;
  children?: ReactNode;
}) {
  return (
    <View
      style={style}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={onGrant}
      onResponderMove={onMove}
      onResponderRelease={onEnd}
      onResponderTerminate={onEnd}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { borderRadius: radius.sm, overflow: 'hidden' },
  abs: { position: 'absolute' },
  badge: { position: 'absolute', top: 8, left: 8 },
  box: { borderWidth: 2, borderColor: '#FFFFFF' },
  third: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.6)' },
  handle: { width: HANDLE_HIT, height: HANDLE_HIT, alignItems: 'center', justifyContent: 'center' },
  dot: { width: HANDLE_DOT, height: HANDLE_DOT, borderRadius: HANDLE_DOT / 2, backgroundColor: '#FFFFFF', borderWidth: 3 },
});
