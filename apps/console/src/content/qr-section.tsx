'use client';

import { useQuery } from '@tanstack/react-query';
import { Button } from '@wayfare/ui/button';
import { Download, Printer } from 'lucide-react';
import { API_BASE_URL } from '../env';
import { useConsole } from '../i18n/provider';
import { Section } from './place-sections';
import { printedCode } from './words';

/** The sticker's SVG, as the API prints it; the route answers an image, not JSON. */
async function stickerSvg(placeId: string): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/admin/places/${placeId}/qr`, {
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
}: {
  placeId: string;
  name: string;
  code: string;
}) {
  const { t } = useConsole();
  const svg = useQuery({
    queryKey: ['place-qr', placeId],
    queryFn: () => stickerSvg(placeId),
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
    <Section id="qr" title={t('qr.title')}>
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
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <p className="text-sm text-foreground">{t('qr.body', { code: printed })}</p>
          <div className="flex flex-wrap gap-2">
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
          <p className="text-xs text-muted-foreground">{t('qr.note', { code: printed })}</p>
        </div>
      </div>
    </Section>
  );
}
