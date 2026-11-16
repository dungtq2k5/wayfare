import localFont from 'next/font/local';
import {
  JetBrains_Mono,
  Noto_Sans_JP,
  Noto_Sans_KR,
  Noto_Sans_SC,
  Noto_Sans_TC,
} from 'next/font/google';

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

// The scripts Be Vietnam Pro lacks (round 29): each loads only for a run in its script, by
// `unicode-range`, so a page in English fetches none of them.
export const notoJp = Noto_Sans_JP({
  weight: ['400', '500', '600'],
  display: 'swap',
  preload: false,
  variable: '--font-noto-jp',
});
export const notoKr = Noto_Sans_KR({
  weight: ['400', '500', '600'],
  display: 'swap',
  preload: false,
  variable: '--font-noto-kr',
});
export const notoSc = Noto_Sans_SC({
  weight: ['400', '500', '600'],
  display: 'swap',
  preload: false,
  variable: '--font-noto-sc',
});
export const notoTc = Noto_Sans_TC({
  weight: ['400', '500', '600'],
  display: 'swap',
  preload: false,
  variable: '--font-noto-tc',
});

/** The code face (the handoff's §4): a Place's code as printed on its sticker. */
export const jetbrainsMono = JetBrains_Mono({
  weight: ['500'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jetbrains-mono',
});

/** Every family's variable, for the document's class. */
export const FONT_VARIABLES = [beVietnamPro, jetbrainsMono, notoJp, notoKr, notoSc, notoTc]
  .map((font) => font.variable)
  .join(' ');
