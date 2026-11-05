/**
 * Same rules as the API (apps/api/src/sales/pricing.ts) so the POS shows exact totals
 * and can sell offline. Works in integer cents to avoid floating-point errors.
 *  - line discounts first
 *  - sale discount (amount and/or percent) shared across lines by value; last line takes the remainder
 *  - tax added on the discounted amount, rounded half-up per line
 */
export interface LineIn {
  price: number | string; // unit price, e.g. "1.50"
  quantity: number; // up to 3 decimals
  discount?: number; // line discount amount
  taxable: boolean;
}

export interface LineOut { gross: number; discount: number; net: number; tax: number; total: number }

export interface Totals {
  lines: LineOut[]; // amounts in currency units (not cents)
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
}

export class PricingError extends Error {}

const cents = (v: number | string) => Math.round(Number(v) * 100);
/** Division of non-negative integers rounded half-up (exact for our sizes). */
const divRound = (a: number, b: number) => Math.floor((2 * a + b) / (2 * b));

export function priceCart(lines: LineIn[], taxRate: number | string, sale: { amount?: number; percent?: number } = {}): Totals {
  if (!lines.length) throw new PricingError('A sale needs at least one item');
  const rateE4 = Math.round(Number(taxRate) * 10000);

  const step = lines.map((l, i) => {
    const qtyMilli = Math.round(l.quantity * 1000);
    const gross = divRound(cents(l.price) * qtyMilli, 1000);
    const disc = cents(l.discount ?? 0);
    if (disc < 0 || disc > gross) throw new PricingError(`Item ${i + 1}: discount must be between 0 and ${(gross / 100).toFixed(2)}`);
    return { gross, lineDisc: disc, value: gross - disc };
  });

  const base = step.reduce((s, l) => s + l.value, 0);
  let saleDisc = 0;
  if (sale.percent !== undefined && sale.percent !== null) {
    if (sale.percent < 0 || sale.percent > 100) throw new PricingError('Discount percent must be between 0 and 100');
    const pctE2 = Math.round(sale.percent * 100);
    saleDisc = divRound(base * pctE2, 10000);
  }
  if (sale.amount) saleDisc += cents(sale.amount);
  if (saleDisc < 0 || saleDisc > base) throw new PricingError(`Sale discount must be between 0 and ${(base / 100).toFixed(2)}`);

  let remaining = saleDisc;
  let lastWithValue = -1;
  step.forEach((l, i) => l.value > 0 && (lastWithValue = i));

  const out = step.map((l, i) => {
    let share = 0;
    if (saleDisc > 0 && l.value > 0) {
      share = i === lastWithValue ? remaining : divRound(saleDisc * l.value, base);
      if (share > l.value) share = l.value;
      remaining -= share;
    }
    const net = l.value - share;
    const tax = lines[i].taxable ? divRound(net * rateE4, 10000) : 0;
    return { gross: l.gross, discount: l.lineDisc + share, net, tax, total: net + tax };
  });

  const sum = (k: keyof LineOut) => out.reduce((s, l) => s + l[k], 0) / 100;
  return {
    lines: out.map((l) => ({ gross: l.gross / 100, discount: l.discount / 100, net: l.net / 100, tax: l.tax / 100, total: l.total / 100 })),
    subtotal: sum('gross'),
    discountTotal: sum('discount'),
    taxTotal: sum('tax'),
    total: sum('total'),
  };
}

/** Loyalty: same formulas as the API. */
export const pointsValue = (points: number, pointValue: number) => Math.floor(Math.round(points * pointValue * 1e6) / 1e4) / 100;
