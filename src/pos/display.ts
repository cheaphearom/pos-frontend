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
}

export interface PaymentProgress {
  paid: number;
  remaining: number;
  change: number;
  khqr: { qr: string; amount: number; expiresAt: string; status: string } | null;
  /** Dual currency: how the change is given */
  changeUsd?: number;
  changeKhr?: number;
}

export interface DisplayState {
  mode: 'idle' | 'cart' | 'pay' | 'done';
  store: { name: string; currency: string; khrRate?: number | null };
  cashier?: string;
  lines: DisplayLine[];
  totals: { subtotal: number; discount: number; tax: number; points: number; total: number; items: number };
  customer?: { name: string; points: number } | null;
  /** While paying */
  payment?: PaymentProgress | null;
  /** After the sale */
  done?: { total: number; paid: number; change: number; changeUsd?: number; changeKhr?: number; receiptNo: string; pointsEarned: number; offline: boolean; queueNo?: string | null } | null;
}

type Msg = { type: 'state'; state: DisplayState } | { type: 'hello' } | { type: 'ping' } | { type: 'bye' };

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
