/** Formatting helpers. The API returns money as strings like "12.50". */
export function money(v: string | number | null | undefined, currency = 'USD') {
  const n = Number(v ?? 0);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 }).format(n);
}

export function num(v: string | number | null | undefined, digits = 0) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(Number(v ?? 0));
}

/** Quantities may be fractional (kg); show up to 3 decimals without trailing zeros. */
export const qty = (v: string | number | null | undefined) => num(v, 3);

export function dateTime(v: string | Date | null | undefined) {
  if (!v) return '';
  return new Date(v).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

export function date(v: string | Date | null | undefined) {
  if (!v) return '';
  return new Date(v).toLocaleDateString('en-GB', { dateStyle: 'medium' });
}

/** YYYY-MM-DD in local time, for API date filters. */
export function isoDate(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
};

const ACRONYMS: Record<string, string> = { KHQR: 'KHQR', E_WALLET: 'Other e-wallet', WALLET: 'Wallet card', TOPUP: 'Top-up', TRANSFER_IN: 'Moved in', TRANSFER_OUT: 'Moved out' };
export const humanize = (s: string) =>
  ACRONYMS[s] ?? s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

/** 8899 0000 0000 0015 */
export const cardNo = (n: string) => n.replace(/(\d{4})(?=\d)/g, '$1 ');
/** •••• 0015 */
export const cardShort = (n: string) => `•••• ${n.slice(-4)}`;
