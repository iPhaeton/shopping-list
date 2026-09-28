import { useCallback, useEffect, useRef, useState } from 'react';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, ScrollView } from 'react-native';
import { Keyboard, Platform } from 'react-native';

/** Clearance between what is revealed and the keyboard's top edge. */
const GAP = 12;

/**
 * Keeps one block of a scroll view — the sign-in card, Sharing's invite field with its suggestions —
 * fully above an open keyboard. iOS's `automaticallyAdjustKeyboardInsets` only brings the focused
 * field itself into view, which on Sign in left `Send code` under the keyboard and on Sharing hid the
 * suggestions that appear below the field.
 *
 * Hand the scroll view `ref`, `onLayout` and `onScroll`, and the block's bottom edge (in the scroll
 * content's coordinates) to `setTarget` whenever it is laid out. While the keyboard is up, a block
 * whose bottom falls below the keyboard is scrolled up just far enough; one already in view is left
 * alone. On iOS the keyboard overlays the scroll view, whose inset the native side grows to allow the
 * scroll; on Android the window shrinks instead, so the scroll view's own height is what is visible.
 */
export function useKeyboardReveal() {
  const ref = useRef<ScrollView>(null);
  const frame = useRef(0);
  const offset = useRef(0);
  const [keyboard, setKeyboard] = useState(0);
  const [target, setTarget] = useState<number | null>(null);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (event) =>
      setKeyboard(event.endCoordinates.height)
    );
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboard(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  useEffect(() => {
    if (keyboard === 0 || target === null) return;
    const visible = frame.current - (Platform.OS === 'ios' ? keyboard : 0);
    const overflow = target + GAP - (offset.current + visible);
    if (overflow > 0) ref.current?.scrollTo({ y: offset.current + overflow, animated: true });
  }, [keyboard, target]);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    frame.current = event.nativeEvent.layout.height;
  }, []);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = event.nativeEvent.contentOffset.y;
  }, []);

  return { ref, onLayout, onScroll, setTarget };
}
