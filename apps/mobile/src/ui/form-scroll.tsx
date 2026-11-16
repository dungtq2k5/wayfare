import { useEffect, useRef, useState } from 'react';
import type { ComponentProps } from 'react';
import { Keyboard, ScrollView, StyleSheet, TextInput } from 'react-native';
import { space } from '@wayfare/design-tokens/tokens';

/**
 * A form's scrolling body that keeps the field being typed in above the keyboard. Edge to edge,
 * Android no longer shrinks the window for the keyboard, so on a long form (or the largest text)
 * the keyboard would cover the field and the button under it: while the keyboard is up the body
 * gains its height at the end, and the focused field is scrolled above the keyboard's top.
 */
export function FormScroll({
  contentContainerStyle,
  onScroll,
  ...props
}: ComponentProps<typeof ScrollView>) {
  const scroll = useRef<ScrollView>(null);
  const offset = useRef(0);
  const [keyboard, setKeyboard] = useState(0);
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', (event) => {
      const { height, screenY } = event.endCoordinates;
      setKeyboard(height);
      // After the room is laid out: the field, and a step of space, above the keyboard.
      requestAnimationFrame(() => {
        TextInput.State.currentlyFocusedInput()?.measureInWindow((_x, y, _width, fieldHeight) => {
          const over = y + fieldHeight + space[4] - screenY;
          if (over > 0) scroll.current?.scrollTo({ y: offset.current + over, animated: true });
        });
      });
    });
    const hidden = Keyboard.addListener('keyboardDidHide', () => setKeyboard(0));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);
  return (
    <ScrollView
      {...props}
      ref={scroll}
      keyboardShouldPersistTaps="handled"
      scrollEventThrottle={16}
      onScroll={(event) => {
        offset.current = event.nativeEvent.contentOffset.y;
        onScroll?.(event);
      }}
      contentContainerStyle={StyleSheet.flatten([
        contentContainerStyle,
        // Only while open: a class's own bottom padding stands otherwise.
        keyboard > 0 ? { paddingBottom: keyboard } : null,
      ])}
    />
  );
}
