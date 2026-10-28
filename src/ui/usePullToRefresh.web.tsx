import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Icon } from './Icon';
import { isPull, PULL_SLOP, PULL_TRIGGER, resist } from './pullGesture';
import { useTheme } from './theme';

/** RN Web's ScrollView ref: the scrolling element, or an object that gives it. */
type ScrollRef = (HTMLElement & { getScrollableNode?: () => HTMLElement }) | null;

/**
 * Pull-to-refresh for the website on phones and tablets. Each page scrolls in its own box (not the whole document),
 * so the browser's own pull-to-refresh never starts; this puts it back. Pull down at the top of the page: a circle
 * follows the finger, its arrow turning as it goes, and letting go past PULL_TRIGGER reloads the page.
 *
 * Touch only (a mouse never pulls), and only a mostly-downward drag that starts with the page at its top. Areas
 * that handle their own touches (CSS touch-action: none, like the crop box) are left alone, and sideways drags (the
 * history timeline, a scrolling grid) never count.
 */
export function usePullToRefresh(): { attach: (node: unknown) => void; indicator: ReactNode } {
  const t = useTheme();
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [pull, setPull] = useState(0);
  const [settling, setSettling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const pullRef = useRef(0);

  const attach = useCallback((n: unknown) => {
    const r = n as ScrollRef;
    setNode(r?.getScrollableNode?.() ?? r ?? null);
  }, []);

  useEffect(() => {
    if (!node) return;
    let start: { x: number; y: number } | null = null;
    /** null: not decided yet; true: pulling; false: something else (scroll, sideways drag), until the finger lifts. */
    let pulling: boolean | null = null;
    const set = (v: number) => {
      pullRef.current = v;
      setPull(v);
    };
    const handlesOwnTouches = (target: EventTarget | null) => {
      for (let el = target instanceof Element ? target : null; el && el !== node; el = el.parentElement) {
        if (getComputedStyle(el).touchAction === 'none') return true;
      }
      return false;
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || node.scrollTop > 0 || handlesOwnTouches(e.target)) {
        start = null;
        return;
      }
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      pulling = null;
      setSettling(false);
    };
    const onMove = (e: TouchEvent) => {
      if (!start || pulling === false) return;
      if (e.touches.length !== 1) {
        pulling = false;
        set(0);
        return;
      }
      const dx = e.touches[0].clientX - start.x;
      const dy = e.touches[0].clientY - start.y;
      if (pulling === null) {
        if (Math.hypot(dx, dy) < PULL_SLOP) return;
        pulling = isPull(dx, dy, node.scrollTop);
        if (!pulling) return;
      }
      // Pulling: keep the browser from scrolling or bouncing too.
      if (e.cancelable) e.preventDefault();
      set(resist(dy));
    };
    const onEnd = () => {
      if (pulling && pullRef.current >= PULL_TRIGGER) {
        setRefreshing(true);
        setSettling(true);
        set(PULL_TRIGGER * 0.8);
        // Long enough to see the spinner before the page goes.
        setTimeout(() => window.location.reload(), 250);
      } else if (pullRef.current > 0) {
        setSettling(true);
        set(0);
      }
      start = null;
      pulling = null;
    };

    node.addEventListener('touchstart', onStart, { passive: true });
    // Not passive: a pull must stop the browser's own scrolling.
    node.addEventListener('touchmove', onMove, { passive: false });
    node.addEventListener('touchend', onEnd);
    node.addEventListener('touchcancel', onEnd);
    return () => {
      node.removeEventListener('touchstart', onStart);
      node.removeEventListener('touchmove', onMove);
      node.removeEventListener('touchend', onEnd);
      node.removeEventListener('touchcancel', onEnd);
    };
  }, [node]);

  const progress = Math.min(1, pull / PULL_TRIGGER);
  const ready = progress >= 1;
  const indicator =
    pull > 0 || refreshing ? (
      <View
        pointerEvents="none"
        accessibilityLiveRegion="polite"
        accessibilityLabel={refreshing ? 'Reloading' : ready ? 'Release to reload' : 'Pull to reload'}
        style={[
          styles.indicator,
          {
            backgroundColor: t.card,
            borderColor: t.separator,
            opacity: refreshing ? 1 : 0.35 + progress * 0.65,
            transform: [{ translateY: pull - 44 }, { scale: 0.7 + progress * 0.3 }],
            // Slides back (or into its reloading spot) smoothly; follows the finger exactly while pulling.
            transitionProperty: settling ? 'transform, opacity' : 'none',
            transitionDuration: '220ms',
          } as object,
        ]}>
        {refreshing ? (
          <ActivityIndicator color={t.tint} />
        ) : (
          <View style={{ transform: [{ rotate: `${progress * 180}deg` }] }}>
            <Icon name="down" color={ready ? t.tint : t.textSecondary} size={20} />
          </View>
        )}
      </View>
    ) : null;

  return { attach, indicator };
}

const styles = StyleSheet.create({
  indicator: {
    position: 'absolute',
    top: 0,
    alignSelf: 'center',
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
    zIndex: 10,
  },
});
