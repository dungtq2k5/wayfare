// Turns Style Dictionary's resolved tokens into one plain model; the formats only render it.

/** The font file each weight is embedded as: Android picks a weight by file, not by number. */
export const FONT_FILES = {
  400: 'BeVietnamPro-Regular',
  500: 'BeVietnamPro-Medium',
  600: 'BeVietnamPro-SemiBold',
  700: 'BeVietnamPro-Bold',
};

const byPath = (tokens, ...prefix) =>
  tokens.filter((token) => prefix.every((part, index) => token.path[index] === part));

/** `{ 'name': value }` of the tokens under `prefix`, keyed by the rest of the path. */
function group(tokens, ...prefix) {
  return Object.fromEntries(
    byPath(tokens, ...prefix).map((token) => [
      token.path.slice(prefix.length).join('.'),
      token.$value,
    ]),
  );
}

const px = (value) => Number.parseFloat(value);
const ms = (value) => Number.parseFloat(value);

/** `#0F766E` → `15 118 110`: channels, so `rgb(var(--x) / <alpha-value>)` can take an opacity. */
export function hexToChannels(hex) {
  const digits = hex.replace('#', '');
  if (digits.length !== 6) throw new Error(`Expected a 6-digit hex colour, got ${hex}`);
  return [0, 2, 4].map((index) => Number.parseInt(digits.slice(index, index + 2), 16)).join(' ');
}

/** Everything the three outputs need, with dimensions as numbers. */
export function buildModel(tokens) {
  const colors = {
    light: group(tokens, 'semantic', 'light', 'color'),
    dark: group(tokens, 'semantic', 'dark', 'color'),
  };
  const sizes = group(tokens, 'font', 'size');
  const leadings = group(tokens, 'font', 'leading');
  const typography = Object.fromEntries(
    byPath(tokens, 'typography').map((token) => {
      const { fontSize, lineHeight, fontWeight } = token.$value;
      const file = FONT_FILES[fontWeight];
      if (file === undefined) throw new Error(`No font file for weight ${fontWeight}`);
      return [
        token.path[1],
        { fontSize: px(fontSize), lineHeight: px(lineHeight), fontFamily: file, fontWeight },
      ];
    }),
  );
  return {
    colors,
    space: Object.fromEntries(Object.entries(group(tokens, 'space')).map(([k, v]) => [k, px(v)])),
    radius: Object.fromEntries(Object.entries(group(tokens, 'radius')).map(([k, v]) => [k, px(v)])),
    fontSize: Object.fromEntries(
      Object.entries(sizes).map(([key, value]) => [
        key,
        { size: px(value), lineHeight: px(leadings[key]) },
      ]),
    ),
    typography,
    elevation: group(tokens, 'elevation'),
    duration: Object.fromEntries(
      Object.entries(group(tokens, 'duration')).map(([k, v]) => [k, ms(v)]),
    ),
    size: Object.fromEntries(Object.entries(group(tokens, 'size')).map(([k, v]) => [k, px(v)])),
  };
}
