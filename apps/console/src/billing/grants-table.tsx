'use client';

import { Pause, Pin } from 'lucide-react';
import { useConsole } from '../i18n/provider';
import { GRANT_KEYS, grantLabel, grantNote, grantPaused, grantValue } from './grants';
import type { Entitlements } from './grants';

/** The *Override* chip (`Badge` `accent`, `pin`): a grant an account holds off its plan. */
export function PinChip({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-xs font-medium whitespace-nowrap text-accent-foreground [&_svg]:size-3">
      <Pin aria-hidden />
      {children}
    </span>
  );
}

/** The muted *Paused* chip (`pause`): a voucher grant held while vouchers aren't sold. */
export function PausedChip() {
  const { t } = useConsole();
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium whitespace-nowrap text-muted-foreground [&_svg]:size-3">
      <Pause aria-hidden />
      {t('grants.paused')}
    </span>
  );
}

/** The line under the voucher grant while vouchers aren't sold: it takes effect when they are. */
export function PausedNote() {
  const { t } = useConsole();
  return (
    <span className="mt-1 flex items-start gap-1 text-xs text-muted-foreground">
      <Pause aria-hidden className="mt-px size-3.5 shrink-0" />
      {t('grants.vouchersPaused')}
    </span>
  );
}

/**
 * The grants in words, one row each (B2, W2): a plan's with its ceilings beside them, or an
 * account's in force beside its plan's — a pinned difference carrying *Override*. A table with row
 * headers, so each value is read with its grant.
 */
export function GrantsTable({
  caption,
  grants,
  plan,
}: {
  caption: string;
  grants: Entitlements;
  /** The account's plan, for the third column. */
  plan?: { label: string; grants: Entitlements; pinned: boolean };
}) {
  const translator = useConsole();
  const { t } = translator;
  const differs = (key: (typeof GRANT_KEYS)[number]) =>
    plan !== undefined &&
    grantValue(key, grants, translator, true) !== grantValue(key, plan.grants, translator, true);
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">{caption}</caption>
      {plan === undefined ? null : (
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th scope="col" className="py-2 pr-4 font-medium">
              {t('grants.grant')}
            </th>
            <th scope="col" className="py-2 pr-4 font-medium">
              {t('grants.inForce')}
            </th>
            <th scope="col" className="py-2 font-medium">
              {plan.label}
            </th>
          </tr>
        </thead>
      )}
      <tbody className="divide-y divide-border">
        {GRANT_KEYS.map((key) => {
          const note = plan === undefined ? grantNote(key, grants, translator) : null;
          return (
            <tr key={key} className="align-top">
              <th
                scope="row"
                className="w-1/3 py-3 pr-4 text-left font-normal text-muted-foreground"
              >
                {grantLabel(key, translator)}
              </th>
              <td className="py-3 pr-4 text-foreground">
                <span className="flex flex-wrap items-center gap-2">
                  {grantValue(key, grants, translator, plan !== undefined)}
                  {plan?.pinned === true && differs(key) ? (
                    <PinChip>{t('grants.override')}</PinChip>
                  ) : null}
                  {plan !== undefined && grantPaused(key, grants) ? <PausedChip /> : null}
                </span>
                {plan === undefined && grantPaused(key, grants) ? <PausedNote /> : null}
              </td>
              {plan === undefined ? (
                <td className="py-3 text-right text-xs text-muted-foreground">{note}</td>
              ) : (
                <td className="py-3 text-muted-foreground">
                  {grantValue(key, plan.grants, translator, true)}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
