/// <reference types="nativewind/types" />
// Metro's own environment (`process.env.EXPO_PUBLIC_*`, `require`) — only that part of `expo/types`:
// its `react-native-web` augmentation would let a web-only prop onto a native component, and the
// generated, ignored `expo-env.d.ts` that names all of it never decides what compiles.
/// <reference types="expo/types/metro-require" />

declare module '*.css';

// Images, bundled by Metro: a module id for <Image source>.
declare module '*.png' {
  const id: number;
  export default id;
}
