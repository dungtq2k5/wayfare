/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  // The class strategy, so colorScheme.set() (Settings → Appearance) decides, not only the system.
  darkMode: 'class',
  // The tokens replace Tailwind's palette and scales; only what the design system names exists.
  presets: [require('nativewind/preset'), require('@wayfare/design-tokens/nativewind-preset')],
  plugins: [],
};
