import localFont from 'next/font/local';

/** Be Vietnam Pro, the tokens' one family, from the design-tokens package. */
export const beVietnamPro = localFont({
  src: [
    { path: '../../../packages/design-tokens/fonts/BeVietnamPro-Regular.ttf', weight: '400' },
    { path: '../../../packages/design-tokens/fonts/BeVietnamPro-Medium.ttf', weight: '500' },
    { path: '../../../packages/design-tokens/fonts/BeVietnamPro-SemiBold.ttf', weight: '600' },
    { path: '../../../packages/design-tokens/fonts/BeVietnamPro-Bold.ttf', weight: '700' },
  ],
  variable: '--font-be-vietnam-pro',
  display: 'swap',
});
