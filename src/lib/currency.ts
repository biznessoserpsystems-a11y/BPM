export interface CurrencyInfo {
  id: number;
  code: string;
  name: string;
  symbol: string;
  decimalPlaces: number;
  isBaseCurrency: boolean;
  isActive: boolean;
}

/**
 * Formats an amount using a currency's own symbol and decimal places,
 * rather than relying on Intl.NumberFormat's built-in ISO currency data
 * (which may not recognize every code, or may format it unexpectedly
 * depending on the runtime's ICU data). Accepts either a currency object
 * (the normal case — pass the live base currency) or a raw symbol string
 * for call sites that already have one on hand. Defaults to the Ghanaian
 * Cedi symbol if no currency is available yet (e.g. still loading) — GHS
 * is this system's fixed base currency (see /api/v1/currencies/[id]/set-base).
 */
export function formatMoney(
  amount: number,
  currency?: Pick<CurrencyInfo, 'symbol' | 'decimalPlaces'> | string | null
): string {
  const symbol = typeof currency === 'string' ? currency : currency?.symbol ?? 'GH₵';
  const decimals = typeof currency === 'string' ? 2 : currency?.decimalPlaces ?? 2;
  const sign = amount < 0 ? '-' : '';
  return `${sign}${symbol}${Math.abs(amount).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}
