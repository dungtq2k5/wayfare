import { WORDMARK_BOX, WORDMARK_PATHS } from './wordmark-paths';

/** The logo: pin, lantern dot, sound waves and the word, in the primary token for the theme. */
export function Wordmark({ height = 32, label = 'Wayfare' }: { height?: number; label?: string }) {
  return (
    <svg
      role="img"
      aria-label={label}
      width={(WORDMARK_BOX.width / WORDMARK_BOX.height) * height}
      height={height}
      viewBox={`0 0 ${WORDMARK_BOX.width} ${WORDMARK_BOX.height}`}
      className="text-primary"
    >
      <path d={WORDMARK_PATHS.pin} fill="currentColor" />
      <path d={WORDMARK_PATHS.voice} className="fill-map-marker-selected" />
      {[WORDMARK_PATHS.wave1, WORDMARK_PATHS.wave2].map((d) => (
        <path
          key={d}
          d={d}
          stroke="currentColor"
          strokeWidth={2.93333}
          strokeLinecap="round"
          fill="none"
        />
      ))}
      <path d={WORDMARK_PATHS.word} fill="currentColor" />
    </svg>
  );
}
