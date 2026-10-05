import { useCallback, useRef } from 'react';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Brings a block that has just grown — Account's delete confirm — fully into view: its bottom edge is
 * scrolled up to the safe area's bottom, with no gap, as task 25 step 1's mockup draws it. A block
 * already in view is left alone. The keyboard's version is `useKeyboardReveal`; this one has no
 * keyboard to wait for, so the caller says when, with the block's bottom in the scroll content's
 * coordinates, once it has been laid out at its new size.
 *
 * The inset is subtracted because the scroll view runs to the bottom of the screen: `Backdrop` does
 * not pad for the home indicator.
 */
export function useScrollReveal() {
  const ref = useRef<ScrollView>(null);
  const frame = useRef(0);
  const offset = useRef(0);
  const { bottom } = useSafeAreaInsets();

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    frame.current = event.nativeEvent.layout.height;
  }, []);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = event.nativeEvent.contentOffset.y;
  }, []);

  const reveal = useCallback(
    (target: number) => {
      const overflow = target - (offset.current + frame.current - bottom);
      if (overflow > 0) ref.current?.scrollTo({ y: offset.current + overflow, animated: true });
    },
    [bottom]
  );

  return { ref, onLayout, onScroll, reveal };
}
