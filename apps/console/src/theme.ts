/** Appearance is per browser (K11): a cookie, so the server renders the right theme with no flash. */
export const THEME_COOKIE = 'wf_theme';

export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export function themeOf(value: string | null | undefined): Theme {
  return (THEMES as readonly string[]).includes(value ?? '') ? (value as Theme) : 'system';
}

/**
 * Applies `system` before the first paint: the one thing the server cannot know is the device's
 * own preference. Inlined in the document's head.
 */
export const SYSTEM_THEME_SCRIPT = `(function(){try{var d=document.documentElement;if(d.dataset.theme==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches)d.classList.add('dark');}catch(e){}})();`;
