// Copyright (c) 2026 Chea Phearom. All rights reserved.
// Proprietary and confidential: see the LICENSE file.
/**
 * Link between the POS window and the customer display window on the same computer.
 * Uses BroadcastChannel: no server, works offline, instant.
 */
export interface DisplayLine {
  name: string;
  quantity: number;
  unit: string;
  price: number;
  total: number;
  promo?: string | null;
  /** Drink options, e.g. "L, Oat milk" (older POS windows put them in the name) */
  options?: string | null;
}

export interface PaymentProgress {
  paid: number;
  remaining: number;
  change: number;
  khqr: { qr: string; amount: number; expiresAt: string; status: string } | null;
  /** Dual currency: how the change is given */
  changeUsd?: number;
  changeKhr?: number;
  /** What has been paid so far, e.g. "Gift voucher GV…" −10 */
  lines?: { label: string; amount: number }[];
}

/** A picture uploaded in the admin (Customer display page), shown on the right during a sale. */
export interface DisplaySlide { id: string; title: string; imageUrl: string; endsAt?: string | null }
/** Where the POS keeps the store's pictures for the display window (same computer, works offline). */
export const slidesKey = (storeId: string) => `pos.slides:${storeId}`;

export interface DisplayState {
  mode: 'idle' | 'cart' | 'pay' | 'done';
  store: { name: string; currency: string; khrRate?: number | null; taxPercent?: number };
  cashier?: string;
  lines: DisplayLine[];
  totals: {
    subtotal: number; discount: number; tax: number; points: number; total: number; items: number;
    /** Parts of the discount, for the summary (older POS versions send only the sum) */
    promotions?: number; lineDiscounts?: number; saleDiscount?: number;
  };
  /** Coupon on this sale */
  coupon?: { code: string; name: string; amount: number } | null;
  /** Gift voucher scanned for this sale (paid with it in the payment window) */
  voucher?: { code: string; balance: number } | null;
  customer?: { name: string; points: number } | null;
  /** While paying */
  payment?: PaymentProgress | null;
  /** After the sale */
  done?: { total: number; paid: number; change: number; changeUsd?: number; changeKhr?: number; receiptNo: string; pointsEarned: number; offline: boolean; queueNo?: string | null } | null;
}

/** close: the POS turns the display off; wake: the POS turns it back on (a display left on standby answers with hello). */
type Msg = { type: 'state'; state: DisplayState } | { type: 'hello' } | { type: 'ping' } | { type: 'bye' } | { type: 'close' } | { type: 'wake' };

export function displayChannel(storeId: string) {
  const ch = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(`pos-display:${storeId}`) : null;
  return {
    supported: !!ch,
    send: (m: Msg) => ch?.postMessage(JSON.parse(JSON.stringify(m))),
    onMessage: (fn: (m: Msg) => void) => {
      if (ch) ch.onmessage = (e) => fn(e.data as Msg);
    },
    close: () => ch?.close(),
  };
}

/**
 * Open the display window. On Chrome/Edge with the Window Management permission it is
 * placed on the other monitor; otherwise it opens as a normal popup to drag across.
 */
export async function openDisplayWindow(storeId: string): Promise<Window | null> {
  const url = `/display?store=${encodeURIComponent(storeId)}`;
  let features = 'popup,width=1280,height=800';
  try {
    const w = window as any;
    if ('getScreenDetails' in w) {
      const details = await w.getScreenDetails();
      const other = details.screens.find((s: any) => s !== details.currentScreen);
      if (other) features = `popup,left=${other.availLeft},top=${other.availTop},width=${other.availWidth},height=${other.availHeight}`;
    }
  } catch {
    /* permission refused or not supported */
  }
  return window.open(url, 'pos-customer-display', features);
}
