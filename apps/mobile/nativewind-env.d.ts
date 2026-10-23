/// <reference types="nativewind/types" />

declare module '*.css';

// Images, bundled by Metro: a module id for <Image source>.
declare module '*.png' {
  const id: number;
  export default id;
}
