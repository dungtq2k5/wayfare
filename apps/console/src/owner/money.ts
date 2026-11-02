/** A price as Stripe states it: "$9.00", "199.000 ₫" — đồng in Vietnam's own form, in either language. */
export function money(amount: { amountMinor: number; currency: string }, locale: string): string {
  const currency = amount.currency.toUpperCase();
  if (currency === 'VND') return `${new Intl.NumberFormat('vi-VN').format(amount.amountMinor)} ₫`;
  const zeroDecimal = currency === 'VND';
  return new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: zeroDecimal ? 0 : 2,
  }).format(zeroDecimal ? amount.amountMinor : amount.amountMinor / 100);
}
