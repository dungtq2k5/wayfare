/** Escapes text for HTML element content and attribute values. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** What the shell places, as plain text; the shell escapes it. */
export interface LayoutParts {
  readonly lang: string;
  readonly subject: string;
  readonly preheader: string;
  readonly paragraphs: readonly string[];
  readonly action?: { readonly label: string; readonly url: string };
  readonly cancel?: { readonly label: string; readonly url: string };
}

/**
 * The one HTML shell (conventions §11.4): inline styles, no images, no external asset, no
 * tracking. It escapes every value it receives.
 */
export function emailLayout(parts: LayoutParts): string {
  const button = (link: { label: string; url: string }, primary: boolean) =>
    `<p style="margin:24px 0"><a href="${escapeHtml(link.url)}" style="${
      primary
        ? 'background:#0f766e;color:#ffffff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block'
        : 'color:#0f766e'
    }">${escapeHtml(link.label)}</a></p>`;
  return [
    '<!doctype html>',
    `<html lang="${escapeHtml(parts.lang)}"><head><meta charset="utf-8">`,
    `<title>${escapeHtml(parts.subject)}</title></head>`,
    '<body style="margin:0;padding:24px;background:#f5f5f4;font-family:Arial,Helvetica,sans-serif;color:#1c1917">',
    `<div style="display:none;max-height:0;overflow:hidden">${escapeHtml(parts.preheader)}</div>`,
    '<div style="max-width:560px;margin:0 auto;background:#ffffff;padding:32px;border-radius:8px">',
    ...parts.paragraphs.map(
      (paragraph) => `<p style="margin:0 0 16px;line-height:1.5">${escapeHtml(paragraph)}</p>`,
    ),
    ...(parts.action === undefined ? [] : [button(parts.action, true)]),
    ...(parts.cancel === undefined ? [] : [button(parts.cancel, false)]),
    '<p style="margin:32px 0 0;font-size:12px;color:#78716c">Wayfare</p>',
    '</div></body></html>',
  ].join('');
}
