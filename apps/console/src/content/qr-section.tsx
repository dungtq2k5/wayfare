'use client';

import { useQuery } from '@tanstack/react-query';
import { Button } from '@wayfare/ui/button';
import { toast } from '@wayfare/ui/toaster';
import { Copy, Download, Printer } from 'lucide-react';
import { API_BASE_URL } from '../env';
import { useConsole } from '../i18n/provider';
import { Section } from './place-sections';
import { printedCode } from './words';

/** The sticker's SVG, as the API prints it; the route answers an image, not JSON. */
async function stickerSvg(path: string): Promise<string> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
    headers: { 'x-wayfare-client': 'console' },
  });
  if (!response.ok) throw new Error(`QR ${response.status}`);
  return response.text();
}

/**
 * The QR sticker (L9): round 28's sticker, its code printed 4 + 4 under it; *Download SVG*
 * (print-ready, named by the code) and *Print*, which prints the sticker alone.
 */
export function QrSection({
  placeId,
  name,
  code,
  src = `/admin/places/${placeId}/qr`,
  title,
  body,
  link,
}: {
  placeId: string;
  name: string;
  code: string;
  /** The sticker's route: the admin's, or the owner's own (round 36), or a tour's (round 39). */
  src?: string;
  title?: string;
  body?: string;
  /** A tour's shareable link (TA6), shown with *Copy link*. */
  link?: string;
}) {
  const { t } = useConsole();
  const svg = useQuery({
    queryKey: ['qr', src],
    queryFn: () => stickerSvg(src),
    staleTime: Infinity,
  });
  const printed = printedCode(code);
  const url =
    svg.data === undefined
      ? null
      : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.data)}`;

  const print = () => {
    if (url === null) return;
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.position = 'fixed';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.srcdoc = `<!doctype html><title>${printed}</title><style>@page{margin:1cm}body{margin:0}img{width:5cm;height:auto}</style><img src="${url}" alt="">`;
    frame.onload = () => {
      frame.contentWindow?.print();
      setTimeout(() => frame.remove(), 60_000);
    };
    document.body.append(frame);
  };

  return (
    <Section id="qr" title={title ?? t('qr.title')}>
      <div className="flex flex-wrap items-center gap-6">
        <div className="flex size-40 shrink-0 items-center justify-center rounded-md border border-border bg-card p-2">
          {url === null ? null : (
            <img
              src={url}
              alt={t('qr.alt', { name, code: printed })}
              className="size-full object-contain"
            />
          )}
        </div>
        <div className="flex min-w-0 grow basis-56 flex-col gap-3">
          <p className="text-sm text-foreground">{body ?? t('qr.body', { code: printed })}</p>
          {link === undefined ? null : <code className="text-sm text-foreground">{link}</code>}
          <div className="flex flex-wrap gap-2">
            {link === undefined ? null : (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(`https://${link}`)
                    .then(() => toast.success(t('tour.linkCopied'), { description: link }))
                }
              >
                <Copy aria-hidden />
                {t('tour.copyLink')}
              </Button>
            )}
            <Button asChild variant="outline" size="sm">
              <a href={url ?? undefined} download={`${code}.svg`} aria-disabled={url === null}>
                <Download aria-hidden />
                {t('qr.download')}
              </a>
            </Button>
            <Button variant="outline" size="sm" disabled={url === null} onClick={print}>
              <Printer aria-hidden />
              {t('qr.print')}
            </Button>
          </div>
          {link === undefined ? (
            <p className="text-xs text-muted-foreground">{t('qr.note', { code: printed })}</p>
          ) : null}
        </div>
      </div>
    </Section>
  );
}
