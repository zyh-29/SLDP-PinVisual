import { SymbolView } from 'expo-symbols';
import type { ComponentProps } from 'react';

type SymbolName = ComponentProps<typeof SymbolView>['name'];

/**
 * Icons used in the app: SF Symbols on iOS, Material Symbols on Android.
 * Icons are always decorative here - meaning is carried by accompanying text.
 */
const ICONS = {
  connected: { ios: 'checkmark.circle.fill', android: 'bluetooth_connected', web: 'bluetooth_connected' },
  disconnected: { ios: 'circle.slash', android: 'bluetooth_disabled', web: 'bluetooth_disabled' },
  connecting: { ios: 'ellipsis.circle', android: 'bluetooth_searching', web: 'bluetooth_searching' },
  send: { ios: 'arrow.up.circle.fill', android: 'upload', web: 'upload' },
  reset: { ios: 'arrow.down.to.line', android: 'vertical_align_bottom', web: 'vertical_align_bottom' },
  clear: { ios: 'eraser', android: 'ink_eraser', web: 'ink_eraser' },
  save: { ios: 'square.and.arrow.down', android: 'save', web: 'save' },
  photo: { ios: 'photo.on.rectangle', android: 'photo_library', web: 'photo_library' },
  success: { ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' },
  error: { ios: 'exclamationmark.triangle.fill', android: 'warning', web: 'warning' },
  info: { ios: 'info.circle', android: 'info', web: 'info' },
  bluetooth: { ios: 'antenna.radiowaves.left.and.right', android: 'bluetooth', web: 'bluetooth' },
  trash: { ios: 'trash', android: 'delete', web: 'delete' },
  close: { ios: 'xmark', android: 'close', web: 'close' },
  lock: { ios: 'lock.fill', android: 'lock', web: 'lock' },
  unlock: { ios: 'lock.open.fill', android: 'lock_open', web: 'lock_open' },
  undo: { ios: 'arrow.uturn.backward', android: 'undo', web: 'undo' },
  redo: { ios: 'arrow.uturn.forward', android: 'redo', web: 'redo' },
  edit: { ios: 'square.and.pencil', android: 'edit', web: 'edit' },
  chevron: { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' },
  minus: { ios: 'minus', android: 'remove', web: 'remove' },
  plus: { ios: 'plus', android: 'add', web: 'add' },
  refresh: { ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' },
  grid: { ios: 'circle.grid.3x3.fill', android: 'grid_on', web: 'grid_on' },
  pin: { ios: 'smallcircle.filled.circle', android: 'radio_button_checked', web: 'radio_button_checked' },
  bookmarks: { ios: 'square.stack', android: 'bookmarks', web: 'bookmarks' },
  sparkles: { ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' },
  stop: { ios: 'stop.circle', android: 'stop_circle', web: 'stop_circle' },
  screen: { ios: 'rectangle.dashed', android: 'screenshot_monitor', web: 'screenshot_monitor' },
  fullscreen: { ios: 'arrow.up.left.and.arrow.down.right', android: 'fullscreen', web: 'fullscreen' },
  camera: { ios: 'camera', android: 'photo_camera', web: 'photo_camera' },
  flip: { ios: 'arrow.triangle.2.circlepath.camera', android: 'flip_camera_android', web: 'flip_camera_android' },
  export: { ios: 'square.and.arrow.up', android: 'ios_share', web: 'ios_share' },
  import: { ios: 'tray.and.arrow.down', android: 'file_open', web: 'file_open' },
  left: { ios: 'arrow.left', android: 'arrow_back', web: 'arrow_back' },
  right: { ios: 'arrow.right', android: 'arrow_forward', web: 'arrow_forward' },
  up: { ios: 'arrow.up', android: 'arrow_upward', web: 'arrow_upward' },
  down: { ios: 'arrow.down', android: 'arrow_downward', web: 'arrow_downward' },
  centre: { ios: 'scope', android: 'center_focus_strong', web: 'center_focus_strong' },
  play: { ios: 'play.fill', android: 'play_arrow', web: 'play_arrow' },
  pause: { ios: 'pause.fill', android: 'pause', web: 'pause' },
  previous: { ios: 'backward.end.fill', android: 'skip_previous', web: 'skip_previous' },
  next: { ios: 'forward.end.fill', android: 'skip_next', web: 'skip_next' },
  stepBack: { ios: 'arrowtriangle.left.fill', android: 'arrow_left', web: 'arrow_left' },
  stepForward: { ios: 'arrowtriangle.right.fill', android: 'arrow_right', web: 'arrow_right' },
  sequence: { ios: 'play.rectangle.on.rectangle', android: 'playlist_play', web: 'playlist_play' },
} as const satisfies Record<string, SymbolName>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, color, size = 20 }: { name: IconName; color: string; size?: number }) {
  return (
    <SymbolView
      name={ICONS[name]}
      tintColor={color}
      size={size}
      accessible={false}
      importantForAccessibility="no"
      style={{ width: size, height: size }}
    />
  );
}
