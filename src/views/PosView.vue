<script setup lang="ts">
/**
 * Cashier checkout screen.
 * - Barcode scanners type the code + Enter into the search box ("3*code" = quantity 3).
 * - Works offline: products come from the local catalogue, prices are calculated on the
 *   device with the same rules as the server, and sales wait in a queue until online.
 */
import { localName } from '@/i18n';
import LangSwitch from '@/components/LangSwitch.vue';
import TouchKeyboard from '@/components/TouchKeyboard.vue';
import NumPad from '@/components/NumPad.vue';
import KeyboardToggle from '@/components/KeyboardToggle.vue';
import { BIG_ZOOM, useBigMode } from '@/composables/useBigMode';
import { useTouchKeyboard } from '@/composables/useTouchKeyboard';
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api, ApiError } from '@/api/client';
import PosPayment, { type PayLine, type WalletCardInfo } from '@/components/pos/PosPayment.vue';
import { formatKhr, splitChange, usdToKhrUp, type ChangeMode } from '@shared/cash';
import PosOptions, { type ChosenOption, type OptionGroup } from '@/components/pos/PosOptions.vue';
import { optionsText } from '@/utils/modifiers';
import PosReceipt from '@/components/pos/PosReceipt.vue';
import ManagerApproval from '@/components/ManagerApproval.vue';
import RegisterReport from '@/components/RegisterReport.vue';
import { useNotify } from '@/composables/useNotify';
import { useCatalog, type CatalogItem } from '@/pos/catalog';
import { isNetworkError, online } from '@/pos/network';
import { PricingError, priceCart, pointsValue } from '@/pos/pricing';
import { applyPromotions, type PromoRule } from '@shared/promotions';
import { couponDiscount, type CouponRule } from '@shared/coupons';
import { enqueue, loadQueue, queue, removeFromQueue, retryQueued, syncingQueue, syncQueue } from '@/pos/queue';
import { uuid } from '@/pos/uuid';
import { displayChannel, openDisplayWindow, type DisplayState, type PaymentProgress } from '@/pos/display';
import { useApp } from '@/stores/app';
import { useAuth } from '@/stores/auth';
import { cardShort, dateTime, humanize, money, qty } from '@/utils/format';

const app = useApp();
const auth = useAuth();
const router = useRouter();
const notify = useNotify();

const store = computed(() => app.currentStore);
const cur = computed(() => store.value?.currency ?? 'USD');
const m = (v: number | string) => money(v, cur.value);
const catalog = useCatalog(app.currentStoreId!);

// ───────────── Cart (kept in localStorage so a reload does not lose it) ─────────────
interface Line { productId: string; categoryId?: string | null; name: string; nameKm?: string | null; sku: string; unit: string; price: string; taxable: boolean; trackStock: boolean; quantity: number; discount: number; modifiers?: ChosenOption[]; note?: string }
interface Cart {
  clientRef: string;
  startedAt: string;
  lines: Line[];
  customer: { id: string; name: string; code: string; phone: string | null; points: number } | null;
  wallet?: WalletCardInfo | null;
  coupon?: (CouponRule & { code: string }) | null;
  voucher?: { code: string; balance: string } | null;
  orderType?: 'TAKEAWAY' | 'DINE_IN' | 'PICKUP';
  tableNo?: string;
  onlineOrderId?: string;
  redeemPoints: number;
  discount: number;
  discountPercent: number;
  note: string;
  /** Manager approval for a discount above the cashier limit */
  approval?: { id: string; manager: string; percent: number } | null;
}
const CART_KEY = `pos.cart:${app.currentStoreId}`;
const HELD_KEY = `pos.held:${app.currentStoreId}`;
const newCart = (): Cart => ({ clientRef: uuid(), startedAt: new Date().toISOString(), lines: [], customer: null, wallet: null, coupon: null, voucher: null, orderType: 'TAKEAWAY', tableNo: '', redeemPoints: 0, discount: 0, discountPercent: 0, note: '' });
const readJson = <T,>(k: string, d: T): T => {
  try { return JSON.parse(localStorage.getItem(k) ?? '') ?? d; } catch { return d; }
};
const cart = reactive<Cart>(readJson(CART_KEY, newCart()));
const held = ref<Cart[]>(readJson(HELD_KEY, []));
watch(cart, (c) => localStorage.setItem(CART_KEY, JSON.stringify(c)), { deep: true });
watch(held, (h) => localStorage.setItem(HELD_KEY, JSON.stringify(h)), { deep: true });

// ───────────── Drink options ─────────────
const optionGroups = ref<OptionGroup[]>(readJson('pos.modifiers', []));
const optProduct = ref<CatalogItem | null>(null);
const optDlg = ref(false);
const optGroupsFor = computed(() =>
  (optProduct.value?.modifierGroupIds ?? []).map((id) => optionGroups.value.find((g) => g.id === id)).filter((g): g is OptionGroup => !!g),
);
function onOptionsChosen(e: { modifiers: ChosenOption[]; quantity: number; note: string }) {
  if (optProduct.value) pushLine(optProduct.value, e.quantity, e.modifiers, e.note);
  focusSearch();
}
const sameOptions = (a?: ChosenOption[], b?: ChosenOption[]) => (a ?? []).map((x) => x.id).join() === (b ?? []).map((x) => x.id).join();

function addProduct(p: CatalogItem, quantity = 1) {
  if (p.modifierGroupIds?.length && optionGroups.value.length) {
    optProduct.value = p;
    optDlg.value = true;
    return;
  }
  pushLine(p, quantity);
}
function pushLine(p: CatalogItem, quantity: number, modifiers: ChosenOption[] = [], note = '') {
  const extra = modifiers.reduce((s, o) => s + Number(o.price), 0);
  const line = cart.lines.find((l) => l.productId === p.id && !l.discount && sameOptions(l.modifiers, modifiers) && (l.note ?? '') === note);
  if (line) line.quantity = round3(line.quantity + quantity);
  else cart.lines.push({
    productId: p.id, categoryId: p.categoryId, name: p.name, nameKm: (p as any).nameKm ?? null, sku: p.sku, unit: p.unit, price: (Number(p.price) + extra).toFixed(2),
    taxable: p.taxable, trackStock: p.trackStock, quantity, discount: 0, modifiers, note,
  });
  if (p.trackStock && Number(p.stock) - (line?.quantity ?? quantity) < 0) notify.error(`Low stock: ${p.name} shows ${qty(p.stock)} left`);
  selected.value = line ? cart.lines.indexOf(line) : cart.lines.length - 1;
}
const round3 = (n: number) => Math.round(n * 1000) / 1000;
function changeQty(i: number, d: number) {
  const l = cart.lines[i];
  l.quantity = round3(Math.max(0, l.quantity + d));
  if (l.quantity === 0) cart.lines.splice(i, 1);
}
function clearCart() {
  Object.assign(cart, newCart());
  search.value = '';
  focusSearch();
}

// ───────────── Promotions (same engine file as the server) ─────────────
const promoData = ref<{ timeZone: string; promotions: PromoRule[] }>(readJson(`pos.promos:${app.currentStoreId}`, { timeZone: 'UTC', promotions: [] }));
const now = ref(new Date());
const clock = setInterval(() => (now.value = new Date()), 30_000); // happy hours start and end while the screen is open
const promos = computed(() =>
  applyPromotions(
    cart.lines.map((l) => ({ productId: l.productId, categoryId: l.categoryId ?? null, price: l.price, quantity: l.quantity })),
    promoData.value.promotions,
    app.currentStoreId!,
    now.value,
    promoData.value.timeZone,
  ),
);
const r2 = (n: number) => Math.round(n * 100) / 100;
/** Total line discount = promotion + manual discount (never more than the line). */
const lineDiscount = (l: Line, i: number) => {
  const gross = r2(Number(l.price) * l.quantity);
  const promo = promos.value[i]?.discount ?? 0;
  return r2(promo + Math.min(l.discount || 0, r2(gross - promo)));
};

// ───────────── Totals (same maths as the server) ─────────────
const taxRate = computed(() => Number(store.value?.taxRate ?? 0));
/** Coupon on the sale value after line discounts and promotions (same file as the server). */
const coupon = computed(() => {
  if (!cart.coupon || !cart.lines.length) return { discount: 0, error: '' };
  const base = cart.lines.reduce((t, l, i) => t + r2(Number(l.price) * l.quantity) - lineDiscount(l, i), 0);
  const r = couponDiscount(cart.coupon, r2(base));
  return { discount: r.discount, error: r.error ?? '' };
});
const priced = computed(() => {
  if (!cart.lines.length) return { totals: null, error: '' };
  try {
    return {
      totals: priceCart(cart.lines.map((l, i) => ({ price: l.price, quantity: l.quantity, discount: lineDiscount(l, i), taxable: l.taxable })), taxRate.value, {
        amount: r2((cart.discount || 0) + coupon.value.discount) || undefined,
        percent: cart.discountPercent || undefined,
      }),
      error: '',
    };
  } catch (e) {
    return { totals: null, error: e instanceof PricingError ? e.message : String(e) };
  }
});
const totals = computed(() => priced.value.totals);

// ───────────── Cashier controls: discount limit ─────────────
/** Manual discount as % of the sale after promotions (coupons and points do not count), like the server. */
const manualAmount = computed(() => {
  const t = totals.value;
  if (!t) return 0;
  const promo = cart.lines.reduce((s, _l, i) => s + (promos.value[i]?.discount ?? 0), 0);
  return Math.max(0, Math.round((Number(t.discountTotal) - promo - coupon.value.discount) * 100) / 100);
});
const manualPercent = computed(() => {
  const t = totals.value;
  if (!t) return 0;
  const promo = cart.lines.reduce((s, _l, i) => s + (promos.value[i]?.discount ?? 0), 0);
  const base = Number(t.subtotal) - promo;
  return base > 0 && manualAmount.value > 0.004 ? Math.round((manualAmount.value / base) * 10000) / 100 : 0;
});
const discountLimit = computed(() => Number((store.value as any)?.cashierMaxDiscountPercent ?? 100));
const needsDiscountPin = computed(() => auth.role === 'CASHIER' && manualPercent.value > discountLimit.value);
const approvalDlg = ref(false);
function onApproved(a: { approvalId: string; manager: string; percent?: number }) {
  cart.approval = { id: a.approvalId, manager: a.manager, percent: a.percent ?? manualPercent.value };
  notify.success(`Approved by ${a.manager}`, `Discount ${cart.approval.percent}%`);
  openPay();
}
const loyalty = ref<{ earnRate: number; pointValue: number }>(readJson('pos.loyalty', { earnRate: 1, pointValue: 0.01 }));
const pointsDiscount = computed(() => (cart.customer && cart.redeemPoints ? pointsValue(cart.redeemPoints, loyalty.value.pointValue) : 0));
const amountDue = computed(() => Math.round(((totals.value?.total ?? 0) - pointsDiscount.value) * 100) / 100);
const maxRedeem = computed(() => {
  if (!cart.customer || !totals.value) return 0;
  return Math.min(cart.customer.points, Math.floor(totals.value.total / loyalty.value.pointValue));
});
const itemCount = computed(() => cart.lines.reduce((s, l) => s + (l.unit === 'pcs' ? l.quantity : 1), 0));

// ───────────── Product search / scanning ─────────────
const search = ref('');
const category = ref<string | null>(null);
const categories = ref<{ id: string; name: string; nameKm?: string | null }[]>(readJson('pos.categories', []));
const searchEl = ref<HTMLInputElement | null>(null);
const results = computed(() => catalog.search(search.value, category.value, 60));
const selected = ref(-1);
const focusSearch = () => nextTick(() => searchEl.value?.focus());
// On-screen keyboard for tills without a keyboard: types into the search box
const touch = useTouchKeyboard();
const kbOpen = ref(true);
// Big mode: the whole POS (and its pop-up windows) larger, still fitting the screen
const big = useBigMode();
function applyBig(on: boolean) {
  const el = document.documentElement;
  el.classList.toggle('pos-big', on);
  el.style.setProperty('--pos-zoom', on ? String(BIG_ZOOM) : '1');
}
watch(big, applyBig, { immediate: true });
onBeforeUnmount(() => applyBig(false));

function onSearchEnter() {
  const raw = search.value.trim();
  if (!raw) return payment.value || openPay();
  // "3*8850000001" → quantity 3
  const mult = /^(\d+(?:\.\d+)?)\*(.+)$/.exec(raw);
  const q = mult ? Number(mult[1]) : 1;
  const code = mult ? mult[2] : raw;
  const hit = catalog.findCode(code) ?? (results.value.length === 1 ? results.value[0] : undefined);
  if (hit) {
    addProduct(hit, q);
    search.value = '';
  } else if (/^\d{12,19}$/.test(code)) {
    search.value = '';
    scanCode(code); // not a product: wallet card, voucher or coupon?
  } else scanCode(code);
}

/** Not a product: ask the server whether it is a wallet card, gift voucher or coupon. */
async function scanCode(code: string) {
  search.value = '';
  if (!online.value) return notify.error(`"${code}" is not a product. Wallet cards, vouchers and coupons need an internet connection.`);
  try {
    const r = await api.get('/codes/lookup', { code, storeId: app.currentStoreId, customerId: cart.customer?.id });
    if (r.kind === 'wallet') return useWalletCard(r.card);
    if (r.kind === 'member') {
      setCustomer(r.customer);
      return notify.success(`Member ${r.customer.name}`, `${r.customer.points} points`);
    }
    if (r.kind === 'voucher') return useVoucher(r.voucher);
    if (r.kind === 'coupon') {
      cart.coupon = { ...r.coupon, value: r.coupon.value, minSpend: r.coupon.minSpend, maxDiscount: r.coupon.maxDiscount };
      notify.success(`Coupon ${r.coupon.code}`, r.coupon.name);
    }
  } catch (e) {
    notify.error(e instanceof ApiError && e.status === 404 ? `Nothing found for "${code}"` : e);
  }
}

// ───────────── Gift vouchers ─────────────
const sellDlg = ref(false);
const sell = reactive({ voucher: null as any, method: 'CASH', reference: '', busy: false });
function useVoucher(v: any) {
  if (v.status === 'INACTIVE') {
    if (!shift.value) { shiftDlg.value = true; return; }
    Object.assign(sell, { voucher: v, method: 'CASH', reference: '', busy: false });
    sellDlg.value = true;
    return;
  }
  if (v.status !== 'ACTIVE') return notify.error(`Voucher ${v.code} is ${v.status.toLowerCase()}`);
  if (v.expired) return notify.error(`Voucher ${v.code} has expired`);
  cart.voucher = { code: v.code, balance: v.balance };
  notify.success(`Voucher ${v.code}`, `${m(v.balance)} to spend. Choose "Voucher" when paying.`);
}
async function doSell() {
  sell.busy = true;
  try {
    const v = await api.post(`/vouchers/${sell.voucher.code}/sell`, { storeId: app.currentStoreId, method: sell.method, reference: sell.reference || undefined });
    sellDlg.value = false;
    notify.success(`Voucher sold: ${m(v.value)}`, `${v.code} is now active`);
    focusSearch();
  } catch (e) { notify.error(e); } finally { sell.busy = false; }
}

// ───────────── Wallet cards ─────────────
function useWalletCard(card: any) {
  if (card.status === 'INACTIVE') return startActivate(card);
  if (card.status !== 'ACTIVE') return notify.error(`Wallet card ${cardShort(card.cardNumber)} is ${card.status.toLowerCase()}`);
  attachWallet(card);
  notify.success(`Wallet ${cardShort(card.cardNumber)}`, `${card.customer?.name ?? ''} · balance ${m(card.balance)}`);
}
function attachWallet(card: any) {
  cart.wallet = { cardNumber: card.cardNumber, balance: card.balance, hasPin: card.hasPin, status: card.status, customer: card.customer };
  if (card.customer) cart.customer = { id: card.customer.id, name: card.customer.name, code: card.customer.code, phone: card.customer.phone, points: card.customer.points };
}

// Activate a new card at the till
const actDlg = ref(false);
const act = reactive({ card: null as any, serial: '', name: '', phone: '', pin: '', busy: false });
function startActivate(card: any) {
  Object.assign(act, { card, serial: '', name: '', phone: '', pin: '', busy: false });
  actDlg.value = true;
}
async function doActivate() {
  act.busy = true;
  try {
    const card = await api.post(`/wallet/cards/${act.card.id}/activate`, { serialNumber: act.serial, name: act.name, phone: act.phone || undefined, pin: act.pin || undefined });
    attachWallet(card);
    actDlg.value = false;
    notify.success('Card activated', `${card.customer?.name}. Top it up to use it.`);
    openTopup(card);
  } catch (e) { notify.error(e); } finally { act.busy = false; }
}

// Top up
const topDlg = ref(false);
const top = reactive({ code: '', card: null as any, amount: 10, method: 'CASH', reference: '', clientRef: '', busy: false });
function openTopup(card?: any) {
  if (!online.value) return notify.error('Top-ups need an internet connection');
  if (!shift.value) { shiftDlg.value = true; return; } // the cash goes into this shift's drawer
  Object.assign(top, { code: '', card: card ?? (cart.wallet ? { ...cart.wallet } : null), amount: 10, method: 'CASH', reference: '', clientRef: uuid(), busy: false });
  topDlg.value = true;
}
async function findTopupCard() {
  try {
    const c = await api.get('/wallet/cards/lookup', { code: top.code.trim() });
    if (c.status === 'INACTIVE') { topDlg.value = false; return startActivate(c); }
    top.card = c;
  } catch (e) { notify.error(e); }
}
async function doTopup() {
  top.busy = true;
  try {
    const id = top.card.id ?? (await api.get('/wallet/cards/lookup', { code: top.card.cardNumber })).id;
    const r = await api.post(`/wallet/cards/${id}/topup`, { storeId: app.currentStoreId, amount: top.amount, method: top.method, reference: top.reference || undefined, clientRef: top.clientRef });
    if (cart.wallet && cart.wallet.cardNumber === r.card.cardNumber) cart.wallet.balance = r.card.balance;
    topDlg.value = false;
    notify.success(`Topped up ${m(top.amount)}`, `New balance ${m(r.card.balance)}`);
    focusSearch();
  } catch (e) { notify.error(e); } finally { top.busy = false; }
}

// ───────────── Customer & loyalty ─────────────
const custDlg = ref(false);
const custCode = ref('');
const custBusy = ref(false);
const newCust = reactive({ show: false, name: '', phone: '' });
async function findCustomer() {
  if (!custCode.value.trim()) return;
  custBusy.value = true;
  try {
    const c = await api.get('/customers/lookup', { code: custCode.value.trim() });
    setCustomer(c);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      newCust.show = true;
      newCust.phone = custCode.value.trim();
    } else notify.error(isNetworkError(e) ? 'Offline: member lookup needs internet' : e);
  } finally {
    custBusy.value = false;
  }
}
async function createCustomer() {
  try {
    setCustomer(await api.post('/customers', { name: newCust.name, phone: newCust.phone || undefined }));
  } catch (e) { notify.error(e); }
}
function setCustomer(c: any) {
  cart.customer = { id: c.id, name: c.name, code: c.code, phone: c.phone, points: c.points };
  cart.redeemPoints = 0;
  custDlg.value = false;
  custCode.value = '';
  newCust.show = false;
  focusSearch();
}

// ───────────── Discounts, hold, note ─────────────
const discDlg = ref(false);
const disc = reactive({ type: 'amount' as 'amount' | 'percent', value: 0 });
function openDiscount() {
  disc.type = cart.discountPercent ? 'percent' : 'amount';
  disc.value = cart.discountPercent || cart.discount || 0;
  discDlg.value = true;
}
function applyDiscount() {
  cart.discount = disc.type === 'amount' ? disc.value : 0;
  cart.discountPercent = disc.type === 'percent' ? disc.value : 0;
  discDlg.value = false;
  focusSearch();
}
const lineDlg = ref(false);
const lineEdit = reactive({ index: -1, quantity: 1, discount: 0 });
function editLine(i: number) {
  const l = cart.lines[i];
  Object.assign(lineEdit, { index: i, quantity: l.quantity, discount: l.discount });
  lineDlg.value = true;
}
function saveLine() {
  const l = cart.lines[lineEdit.index];
  if (lineEdit.quantity <= 0) cart.lines.splice(lineEdit.index, 1);
  else Object.assign(l, { quantity: round3(lineEdit.quantity), discount: lineEdit.discount || 0 });
  lineDlg.value = false;
  focusSearch();
}

function hold() {
  if (!cart.lines.length) return;
  held.value.push(JSON.parse(JSON.stringify(cart)));
  clearCart();
  notify.success('Sale on hold', 'Recall it from "Held"');
}
const heldDlg = ref(false);
function recall(i: number) {
  if (cart.lines.length) hold();
  Object.assign(cart, held.value.splice(i, 1)[0]);
  heldDlg.value = false;
}

// ───────────── Shift ─────────────
const shift = ref<any>(readJson(`pos.shift:${app.currentStoreId}`, null));
const shiftDlg = ref(false);
const openingCash = ref(0);
const openingKhr = ref(0);
/** Touch: which opening amount the number pad types into */
const shiftField = ref<'usd' | 'khr'>('usd');
const shiftPadValue = computed<number | null>({
  get: () => (shiftField.value === 'usd' ? openingCash.value : openingKhr.value),
  set: (v) => (shiftField.value === 'usd' ? (openingCash.value = v ?? 0) : (openingKhr.value = v ?? 0)),
});
const noOsKeyboard = computed(() => (touch.value ? { pcInputText: { root: { inputmode: 'none' } } } : undefined));
async function loadShift() {
  try {
    shift.value = await api.get('/shifts/current', { storeId: app.currentStoreId });
    localStorage.setItem(`pos.shift:${app.currentStoreId}`, JSON.stringify(shift.value));
  } catch (e) {
    if (!isNetworkError(e)) notify.error(e);
  }
}
async function openShift() {
  try {
    shift.value = await api.post('/shifts/open', { storeId: app.currentStoreId, openingCash: openingCash.value, openingKhr: khrRate.value ? openingKhr.value || 0 : undefined });
    localStorage.setItem(`pos.shift:${app.currentStoreId}`, JSON.stringify(shift.value));
    shiftDlg.value = false;
    notify.success('Shift opened');
    focusSearch();
  } catch (e) { notify.error(e); }
}

// ───────────── Pay & complete ─────────────
const payment = ref(false);
const paying = ref(false);
const receipt = ref<any>(null);
const receiptDlg = ref(false);

function openPay() {
  if (!cart.lines.length) return;
  if (priced.value.error) return notify.error(priced.value.error);
  if (coupon.value.error) return notify.error(coupon.value.error);
  if (needsDiscountPin.value && !(cart.approval && cart.approval.percent >= manualPercent.value)) {
    if (!online.value) return notify.error(`Discounts above ${discountLimit.value}% need a manager PIN and a connection`);
    approvalDlg.value = true;
    return;
  }
  if (online.value && !shift.value) {
    shiftDlg.value = true;
    return;
  }
  payment.value = true;
}

async function complete(payments: PayLine[], changeIn: ChangeMode = 'MIXED') {
  paying.value = true;
  const body = {
    storeId: app.currentStoreId,
    clientRef: cart.clientRef,
    items: cart.lines.map((l) => ({
      productId: l.productId, quantity: l.quantity, discount: l.discount || undefined,
      modifiers: l.modifiers?.length ? l.modifiers.map((o) => o.id) : undefined, note: l.note || undefined,
    })),
    ...(store.value?.hasKitchen && { orderType: cart.orderType ?? 'TAKEAWAY', tableNo: cart.orderType === 'DINE_IN' && cart.tableNo ? cart.tableNo : undefined }),
    onlineOrderId: cart.onlineOrderId,
    payments,
    customerId: cart.customer?.id,
    redeemPoints: cart.redeemPoints || undefined,
    couponCode: cart.coupon?.code,
    discount: cart.discount || undefined,
    discountPercent: cart.discountPercent || undefined,
    approvalId: needsDiscountPin.value ? cart.approval?.id : undefined,
    changeIn: khrRate.value ? changeIn : undefined,
    note: cart.note || undefined,
  };
  try {
    let sale: any;
    if (online.value) {
      try {
        sale = await api.post('/sales', body);
      } catch (e) {
        if (!isNetworkError(e)) throw e;
        sale = await saveOffline(body, payments); // connection dropped mid-sale
      }
    } else sale = await saveOffline(body, payments);

    cart.lines.forEach((l) => catalog.deduct(l.productId, l.quantity));
    receipt.value = sale;
    showDone(sale);
    payment.value = false;
    receiptDlg.value = true;
    Object.assign(cart, newCart());
  } catch (e) {
    if (e instanceof ApiError && e.status === 403 && /approval/i.test(e.message)) cart.approval = null; // expired or used: ask again
    notify.error(e);
  } finally {
    paying.value = false;
  }
}

/** Queue the sale and build a local receipt from the on-device calculation. */
async function saveOffline(body: any, payments: { method: string; amount: number }[]) {
  if (body.redeemPoints) throw new Error('Points cannot be used while offline. Remove the points and try again.');
  if (body.couponCode) throw new Error('Coupons cannot be used while offline. Remove the coupon and try again.');
  if (body.onlineOrderId) throw new Error('Online orders need a connection.');
  if (payments.some((p: any) => p.method === 'VOUCHER' || p.method === 'WALLET')) throw new Error('Vouchers and wallet cards need a connection.');
  const t = totals.value!;
  const paid = payments.reduce((s, p) => s + p.amount, 0);
  const local = {
    offline: true,
    receiptNo: 'OFF-' + body.clientRef.slice(0, 8).toUpperCase(),
    createdAt: new Date().toISOString(),
    store: store.value,
    cashier: { fullName: auth.user?.fullName },
    customer: cart.customer,
    items: cart.lines.map((l, i) => ({ name: l.name, nameKm: l.nameKm, quantity: l.quantity, unitPrice: l.price, discount: t.lines[i].discount, lineTotal: t.lines[i].total, promotion: promos.value[i]?.name ? { name: promos.value[i].name } : null, modifiers: l.modifiers, note: l.note })),
    orderType: store.value?.hasKitchen ? cart.orderType : undefined, tableNo: cart.tableNo,
    subtotal: t.subtotal, discountTotal: t.discountTotal, taxTotal: t.taxTotal, total: t.total,
    pointsRedeemed: 0, pointsDiscount: 0, payments,
    changeDue: Math.round((paid - t.total) * 100) / 100,
    ...((c) => ({ changeUsd: c.usd, changeKhr: c.khr }))(splitChange(Math.round((paid - t.total) * 100) / 100, khrRate.value, body.changeIn)),
  };
  await enqueue({ clientRef: body.clientRef, body: { ...body, offlineCreatedAt: local.createdAt }, createdAt: local.createdAt, attempts: 0, receipt: local });
  return local;
}

function printReceipt() {
  document.body.classList.add('printing-pos');
  window.print();
  setTimeout(() => document.body.classList.remove('printing-pos'), 500);
}
function nextSale() {
  receiptDlg.value = false;
  focusSearch();
}

// ───────────── Online orders (order ahead / table QR) ─────────────
const onlineOrders = ref<any[]>([]);
const onlineDlg = ref(false);
const onlineBusy = ref('');
let onlineTimer: ReturnType<typeof setInterval> | undefined;
async function loadOnline() {
  if (!online.value || !(store.value as any)?.onlineOrdering) return;
  try { onlineOrders.value = await api.get('/online-orders', { storeId: app.currentStoreId }); } catch { /* keep the last list */ }
}
async function confirmOnline(o: any) {
  onlineBusy.value = o.id;
  try {
    const r = await api.post(`/online-orders/${o.id}/confirm-payment`);
    if (r.status === 'PAID') notify.success('Payment confirmed', `${o.customerName}'s order went to the barista`);
    else notify.error(r.error ?? 'Could not create the sale');
    loadOnline();
  } catch (e) { notify.error(e); } finally { onlineBusy.value = ''; }
}
async function cancelOnline(o: any) {
  if (!confirm(`Cancel ${o.customerName}'s online order?`)) return;
  try { await api.post(`/online-orders/${o.id}/cancel`); loadOnline(); } catch (e) { notify.error(e); }
}
/** Pay-at-counter: put the online order into the cart, then take payment as usual. */
async function takeOnline(o: any) {
  if (cart.lines.length) hold();
  const full = await api.get(`/online-orders/${o.id}`);
  const missing: string[] = [];
  for (const l of full.lines) {
    const p = catalog.items.value.find((x) => x.id === l.productId);
    if (!p) { missing.push(l.name); continue; }
    pushLine(p, Number(l.quantity), (l.modifiers ?? []).map((m: any) => ({ id: m.id, group: m.group, option: m.option, price: m.price })), l.note ?? '');
  }
  if (missing.length) notify.error(`Not on this till's product list: ${missing.join(', ')}`);
  cart.onlineOrderId = o.id;
  cart.orderType = full.orderType === 'DINE_IN' ? 'DINE_IN' : 'PICKUP';
  cart.tableNo = full.tableNo ?? '';
  cart.note = `Online · ${full.customerName}${full.phone ? ' · ' + full.phone : ''}`;
  if (full.customerId) {
    // Ordered from the member app: same member, and the points they chose to use.
    try {
      setCustomer(await api.get(`/customers/${full.customerId}`));
      cart.redeemPoints = full.redeemPoints ?? 0;
    } catch { /* member removed */ }
  } else if (full.phone) {
    try { setCustomer(await api.get('/customers/lookup', { code: full.phone })); } catch { /* not a member */ }
  }
  if (full.couponCode) await scanCode(full.couponCode);
  onlineDlg.value = false;
  notify.success(`${full.customerName}'s order is in the cart`, 'Take payment as usual');
}
const waitingOnline = computed(() => onlineOrders.value.length);

// ───────────── Customer display (second screen) ─────────────
const display = displayChannel(app.currentStoreId!);
const displayConnected = ref(false);
const payProgress = ref<PaymentProgress | null>(null);
const doneInfo = ref<DisplayState['done']>(null);
let doneTimer: ReturnType<typeof setTimeout> | undefined;

function showDone(sale: any) {
  const paid = (sale.payments ?? []).reduce((s: number, p: any) => s + Number(p.amount), 0);
  doneInfo.value = {
    total: Number(sale.amountDue ?? sale.total), paid, change: Number(sale.changeDue ?? 0), changeUsd: Number(sale.changeUsd ?? sale.changeDue ?? 0), changeKhr: Number(sale.changeKhr ?? 0),
    receiptNo: sale.receiptNo, queueNo: sale.queueNo ?? null, pointsEarned: sale.pointsEarned ?? 0, offline: !!sale.offline,
  };
  clearTimeout(doneTimer);
  doneTimer = setTimeout(() => (doneInfo.value = null), 20_000); // back to the welcome screen
}

/** Each category gets its own colour on the product tiles, so cashiers find items by colour. */
const TILE_COLORS = ['#8b5a33', '#2f7d6b', '#c8893f', '#7a4f9a', '#2c6e9b', '#b2493b', '#5f7d2f', '#9a6a00', '#4f6b7a', '#a14d7a'];
function catColor(categoryId?: string | null) {
  const i = categories.value.findIndex((c) => c.id === categoryId);
  return i < 0 ? '#9a8b7f' : TILE_COLORS[i % TILE_COLORS.length];
}
const initials = (name: string) => name.split(/\s+/).filter((w) => /^[\p{L}]/u.test(w)).slice(0, 2).map((w) => [...w][0]).join('').toUpperCase() || '•';

/** Riel per dollar for this store (null = no riel cash) */
const khrRate = computed<number | null>(() => (store.value as any)?.khrRate ?? null);

// ───────────── Cash in / out and X report ─────────────
const cashDlg = ref(false);
const cashForm = reactive({ type: 'PAY_OUT' as 'PAY_IN' | 'PAY_OUT', currency: 'USD' as 'USD' | 'KHR', amount: 0, reason: '', busy: false });
const cashApprDlg = ref(false);
const cashUsdValue = computed(() => (cashForm.currency === 'KHR' && khrRate.value ? Math.round((cashForm.amount / khrRate.value) * 100) / 100 : cashForm.amount));
function openCash(type: 'PAY_IN' | 'PAY_OUT') {
  if (!shift.value) { shiftDlg.value = true; return; }
  Object.assign(cashForm, { type, currency: 'USD', amount: 0, reason: '', busy: false });
  cashDlg.value = true;
}
function saveCash() {
  if (!cashForm.amount || cashForm.reason.trim().length < 3) return notify.error('Enter the amount and the reason');
  const needPin = cashForm.type === 'PAY_OUT' && auth.role === 'CASHIER' && (store.value as any)?.cashOutNeedsApproval !== false;
  if (needPin) { cashApprDlg.value = true; return; }
  doSaveCash();
}
async function doSaveCash(approvalId?: string) {
  cashForm.busy = true;
  try {
    await api.post(`/shifts/${shift.value.id}/cash`, { type: cashForm.type, currency: cashForm.currency, amount: cashForm.amount, reason: cashForm.reason.trim(), approvalId });
    notify.success(cashForm.type === 'PAY_IN' ? 'Cash in recorded' : 'Cash out recorded', `${cashForm.currency === 'KHR' ? formatKhr(cashForm.amount) : m(cashForm.amount)} · ${cashForm.reason}`);
    cashDlg.value = false;
  } catch (e) { notify.error(e); } finally { cashForm.busy = false; }
}
const xDlg = ref(false);
const xReport = ref<any>(null);
async function openX() {
  if (!shift.value) return notify.error('No open shift');
  try { xReport.value = await api.get(`/shifts/${shift.value.id}/x-report`); xDlg.value = true; } catch (e) { notify.error(e); }
}
function printX() {
  document.body.classList.add('printing-report');
  window.print();
  setTimeout(() => document.body.classList.remove('printing-report'), 500);
}

const displayState = computed<DisplayState>(() => {
  const t = totals.value;
  const base = {
    store: { name: store.value?.name ?? '', currency: cur.value, khrRate: khrRate.value },
    cashier: auth.user?.fullName,
    customer: cart.customer ? { name: cart.customer.name, points: cart.customer.points } : null,
    lines: cart.lines.map((l, i) => ({
      name: l.modifiers?.length ? `${localName(l)} (${optionsText(l.modifiers)})` : localName(l), quantity: l.quantity, unit: l.unit, price: Number(l.price),
      total: t?.lines[i]?.total ?? 0, promo: promos.value[i]?.discount ? `${promos.value[i].name} −${m(promos.value[i].discount)}` : null,
    })),
    totals: { subtotal: t?.subtotal ?? 0, discount: t?.discountTotal ?? 0, tax: t?.taxTotal ?? 0, points: pointsDiscount.value, total: amountDue.value, items: itemCount.value },
  };
  if (doneInfo.value && !cart.lines.length) return { ...base, mode: 'done', done: doneInfo.value };
  if (payment.value && payProgress.value) return { ...base, mode: 'pay', payment: payProgress.value };
  return { ...base, mode: cart.lines.length ? 'cart' : 'idle' };
});

watch(displayState, (state) => display.send({ type: 'state', state }), { deep: true });
watch(() => cart.lines.length, (n) => n && (doneInfo.value = null));
let displaySeen = 0;
display.onMessage((msg) => {
  if (msg.type === 'hello' || msg.type === 'ping') {
    if (msg.type === 'hello' || !displayConnected.value) display.send({ type: 'state', state: displayState.value });
    displayConnected.value = true;
    displaySeen = Date.now();
  } else if (msg.type === 'bye') displayConnected.value = false;
});
// No heartbeat for 10 s = the display window was closed or crashed.
const displayWatch = setInterval(() => {
  if (displayConnected.value && Date.now() - displaySeen > 10_000) displayConnected.value = false;
}, 2000);
display.send({ type: 'hello' }); // ask an already-open display to say hello back

async function openDisplay() {
  const w = await openDisplayWindow(app.currentStoreId!);
  if (!w) notify.error('The browser blocked the window. Allow pop-ups for this site and try again.');
}

// ───────────── Offline queue panel ─────────────
const queueDlg = ref(false);
const failedCount = computed(() => queue.value.filter((q) => q.error).length);
async function syncNow() {
  const r = await syncQueue();
  if (r.sent) notify.success(`${r.sent} offline sale(s) uploaded`);
  if (r.failed) notify.error(`${r.failed} sale(s) were rejected. Open the queue to see why.`);
}
function discardQueued(ref: string) {
  if (confirm('Delete this offline sale? It will not be recorded.')) removeFromQueue(ref);
}

// ───────────── Startup & keyboard ─────────────
let syncTimer: ReturnType<typeof setInterval> | undefined;
async function refreshData() {
  if (!online.value) return;
  await Promise.allSettled([
    catalog.sync(),
    loadShift(),
    api.get('/categories').then((c) => { categories.value = c; localStorage.setItem('pos.categories', JSON.stringify(c)); }),
    api.get('/customers/loyalty-rules').then((r) => { loyalty.value = r; localStorage.setItem('pos.loyalty', JSON.stringify(r)); }),
    loadPromos(),
    api.get('/modifiers').then((g) => { optionGroups.value = g.filter((x: any) => x.isActive); localStorage.setItem('pos.modifiers', JSON.stringify(optionGroups.value)); }),
    syncNow(),
  ]);
}

async function loadPromos() {
  const r = await api.get('/promotions/active', { storeId: app.currentStoreId });
  promoData.value = { timeZone: r.timeZone, promotions: r.promotions };
  localStorage.setItem(`pos.promos:${app.currentStoreId}`, JSON.stringify(promoData.value));
}

function onKey(e: KeyboardEvent) {
  const dialogOpen = onlineDlg.value || optDlg.value || payment.value || receiptDlg.value || custDlg.value || discDlg.value || lineDlg.value || shiftDlg.value || heldDlg.value || queueDlg.value || cashDlg.value || xDlg.value || cashApprDlg.value || approvalDlg.value;
  if (e.key === 'F9' || (e.key === 'Enter' && e.ctrlKey)) { e.preventDefault(); if (!dialogOpen) openPay(); }
  else if (e.key === 'F2') { e.preventDefault(); focusSearch(); }
  else if (e.key === 'F4' && !dialogOpen) { e.preventDefault(); custDlg.value = true; }
  else if (e.key === 'Enter' && receiptDlg.value) { e.preventDefault(); nextSale(); }
  else if (!dialogOpen && document.activeElement === document.body && e.key.length === 1) focusSearch(); // scanner typing anywhere
}

watch(online, (v) => v && refreshData());
onMounted(async () => {
  await loadQueue();
  const hadLocal = await catalog.loadLocal();
  focusSearch();
  if (online.value) {
    if (!hadLocal) notify.success('Downloading products…');
    await refreshData();
  }
  loadOnline();
  onlineTimer = setInterval(loadOnline, 10_000);
  syncTimer = setInterval(() => {
    if (!online.value) return;
    catalog.sync().catch(() => undefined);
    loadPromos().catch(() => undefined);
  }, 5 * 60_000);
  window.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  clearInterval(onlineTimer);
  display.close();
  clearInterval(displayWatch);
  clearTimeout(doneTimer);
  clearInterval(syncTimer);
  clearInterval(clock);
  window.removeEventListener('keydown', onKey);
});

async function logout() {
  if (queue.value.length && !confirm(`${queue.value.length} offline sale(s) are not uploaded yet. They stay on this device. Log out anyway?`)) return;
  await auth.logout();
  router.push('/login');
}
</script>

<template>
  <div class="pos-screen">
    <!-- Top bar -->
    <header class="bar">
      <RouterLink v-if="auth.isManager" to="/" class="back" v-tooltip.bottom="'Back to admin'" aria-label="Back to admin"><i class="pi pi-arrow-left" /></RouterLink>
      <span class="logo" aria-hidden="true"><i class="pi pi-shopping-bag" /></span>
      <div class="title">
        <b>{{ store?.name }}</b>
        <span class="who"><i class="pi pi-user" /> {{ auth.user?.fullName }}</span>
      </div>
      <Select v-if="app.stores.length > 1" v-model="app.currentStoreId" :options="app.stores" option-label="code" option-value="id" size="small" :disabled="cart.lines.length > 0" />
      <span class="net" :class="online ? 'on' : 'off'" role="status"><i class="dot" />{{ online ? 'Online' : 'OFFLINE' }}</span>
      <div class="spacer" />
      <div class="tools">
      <Button v-if="(store as any)?.onlineOrdering" :label="`Online${waitingOnline ? ' (' + waitingOnline + ')' : ''}`" icon="pi pi-globe" size="small" :severity="waitingOnline ? 'warn' : 'secondary'" :outlined="!!waitingOnline" :text="!waitingOnline" @click="loadOnline(); onlineDlg = true" />
      <Button icon="pi pi-wallet" label="Top up" size="small" text :disabled="!online" v-tooltip.bottom="'Top up a wallet card'" @click="openTopup()" />
      <Button v-if="shift" icon="pi pi-arrow-right-arrow-left" label="Cash in/out" size="small" text :disabled="!online" v-tooltip.bottom="'Money put in or taken out of the drawer'" @click="openCash('PAY_OUT')" />
      <Button v-if="shift" icon="pi pi-file" label="X report" size="small" text :disabled="!online" v-tooltip.bottom="'Print the shift so far'" @click="openX" />
      <Button :icon="displayConnected ? 'pi pi-desktop' : 'pi pi-external-link'" :label="displayConnected ? 'Display on' : 'Customer display'" size="small" :severity="displayConnected ? 'success' : 'secondary'" text v-tooltip.bottom="'Open the customer-facing screen'" @click="openDisplay" />
      </div>
      <Button v-if="queue.length" :label="`${queue.length} to upload`" :icon="syncingQueue ? 'pi pi-spin pi-sync' : 'pi pi-cloud-upload'" size="small" :severity="failedCount ? 'danger' : 'warn'" outlined @click="queueDlg = true" />
      <Button v-if="shift" class="shift-chip" :label="(big ? '' : 'Shift since ') + new Date(shift.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })" icon="pi pi-clock" size="small" severity="secondary" outlined @click="router.push(`/shifts?open=${shift.id}`)" />
      <Button v-else label="Open shift" icon="pi pi-play" size="small" @click="shiftDlg = true" :disabled="!online" />
      <Button :icon="big ? 'pi pi-search-minus' : 'pi pi-search-plus'" :label="big ? 'Normal' : 'Big'" size="small" :severity="big ? undefined : 'secondary'" :outlined="!big"
        :aria-pressed="big" v-tooltip.bottom="big ? 'Back to the normal size' : 'Make everything bigger'" @click="big = !big" />
      <LangSwitch />
      <Button icon="pi pi-sign-out" text rounded severity="secondary" aria-label="Log out" v-tooltip.bottom="'Log out'" @click="logout" />
    </header>

    <div class="body">
      <!-- Products -->
      <section class="catalog-panel">
        <div class="search">
          <i class="pi pi-search" />
          <input ref="searchEl" v-model="search" class="search-input" placeholder="Scan barcode or search… (F2)   e.g. 3*8850000001 for 3 pcs"
            autocomplete="off" :inputmode="touch ? 'none' : undefined" @keydown.enter.prevent="onSearchEnter" @keydown.esc="search = ''" @focus="kbOpen = true" @click="kbOpen = true" />
          <button v-if="search" type="button" class="search-btn" aria-label="Clear search" @mousedown.prevent @click="search = ''"><i class="pi pi-times" /></button>
          <KeyboardToggle @changed="kbOpen = true; focusSearch()" />
          <span v-if="catalog.syncing.value" class="pi pi-spin pi-sync muted" v-tooltip="'Updating products'" />
        </div>
        <div class="cats">
          <button class="chip" :class="{ on: !category }" @click="category = null">All</button>
          <button v-for="c in categories.filter((x) => catalog.items.value.some((p) => p.categoryId === x.id))" :key="c.id" class="chip" :class="{ on: category === c.id }" @click="category = category === c.id ? null : c.id">{{ localName(c) }}</button>
        </div>
        <div class="tiles">
          <button v-for="p in results" :key="p.id" class="tile" :class="{ out: p.trackStock && Number(p.stock) <= 0 }" :style="{ '--cat': catColor(p.categoryId) }" @click="addProduct(p); focusSearch()">
            <img v-if="p.imageUrl" :src="p.imageUrl" alt="" class="tile-img" loading="lazy" />
            <span v-else class="tile-ini" aria-hidden="true" :data-ini="initials(localName(p as any))" />
            <span class="name">{{ localName(p as any) }}<i v-if="p.modifierGroupIds?.length" class="pi pi-sliders-h opt-mark" v-tooltip="'Has options'" /></span>
            <span class="price">{{ m(p.price) }}</span>
            <span class="meta">
              <span class="mono">{{ p.sku }}</span>
              <span v-if="p.trackStock" class="stock" :class="{ neg: Number(p.stock) <= 0, low: Number(p.stock) > 0 && Number(p.stock) <= 5 }">{{ qty(p.stock) }} {{ p.unit }}</span>
            </span>
          </button>
          <div v-if="!results.length" class="empty muted">
            {{ catalog.items.value.length ? 'No matching products' : online ? 'Loading products…' : 'No products saved on this device yet. Connect to the internet once to download them.' }}
          </div>
        </div>
        <TouchKeyboard v-if="touch && kbOpen" v-model="search" enter-label="Add" class="pos-kb" @enter="search.trim() && onSearchEnter()" @close="kbOpen = false" />
      </section>

      <!-- Cart -->
      <section class="cart-panel">
        <div v-if="store?.hasKitchen" class="otype">
          <SelectButton v-model="cart.orderType" :options="[{ l: 'Takeaway', v: 'TAKEAWAY' }, { l: 'Dine-in', v: 'DINE_IN' }]" option-label="l" option-value="v" :allow-empty="false" size="small" />
          <InputText v-if="cart.orderType === 'DINE_IN'" v-model="cart.tableNo" placeholder="Table" size="small" style="width: 80px" maxlength="20" />
        </div>
        <div class="cust">
          <template v-if="cart.customer">
            <i class="pi pi-user" />
            <div style="flex: 1; min-width: 0">
              <b>{{ cart.customer.name }}</b>
              <div class="small muted">{{ cart.customer.code }} · {{ cart.customer.points }} points</div>
              <div v-if="cart.wallet" class="small wallet-line"><i class="pi pi-wallet" /> {{ cardShort(cart.wallet.cardNumber) }} · {{ m(cart.wallet.balance) }}</div>
            </div>
            <Button icon="pi pi-times" text rounded size="small" aria-label="Remove customer" @click="cart.customer = null; cart.wallet = null; cart.redeemPoints = 0" />
          </template>
          <Button v-else label="Add member (F4)" icon="pi pi-user-plus" text size="small" @click="custDlg = true" />
        </div>

        <div class="lines">
          <div v-for="(l, i) in cart.lines" :key="i" class="line" :class="{ sel: selected === i }" @click="selected = i">
            <div class="ln-main" @dblclick="editLine(i)">
              <div class="ln-name">{{ localName(l) }}</div>
              <div v-if="l.modifiers?.length" class="small ln-opts">{{ optionsText(l.modifiers) }}</div>
              <div v-if="l.note" class="small ln-note"><i class="pi pi-comment" /> {{ l.note }}</div>
              <div class="small muted">{{ m(l.price) }} / {{ l.unit }}<span v-if="l.discount" class="neg"> · −{{ m(l.discount) }}</span></div>
              <div v-if="promos[i]?.discount" class="promo small"><i class="pi pi-tag" /> {{ promos[i].name }} −{{ m(promos[i].discount) }}</div>
            </div>
            <div class="qty">
              <button aria-label="Less" @click.stop="changeQty(i, -1)"><i class="pi pi-minus" /></button>
              <span class="num" @click.stop="editLine(i)">{{ qty(l.quantity) }}</span>
              <button aria-label="More" @click.stop="changeQty(i, 1)"><i class="pi pi-plus" /></button>
            </div>
            <div class="ln-total num">{{ totals ? m(totals.lines[i]?.total ?? 0) : '' }}</div>
            <button class="ln-edit" aria-label="Edit line" @click.stop="editLine(i)"><i class="pi pi-ellipsis-v" /></button>
          </div>
          <div v-if="!cart.lines.length" class="empty muted cart-empty"><span class="empty-ic"><i class="pi pi-shopping-cart" /></span><div>Scan or tap a product to start</div></div>
        </div>

        <div class="sum">
          <Message v-if="priced.error" severity="error" :closable="false" size="small">{{ priced.error }}</Message>
          <div class="r"><span>Subtotal <span class="muted small">({{ qty(itemCount) }} items)</span></span><span class="num">{{ m(totals?.subtotal ?? 0) }}</span></div>
          <div v-if="totals?.discountTotal" class="r"><span>Discount<span v-if="needsDiscountPin" class="small" :class="cart.approval && cart.approval.percent >= manualPercent ? 'muted' : 'neg'"> · {{ cart.approval && cart.approval.percent >= manualPercent ? `approved by ${cart.approval.manager}` : 'needs manager PIN' }}</span></span><span class="num neg">−{{ m(totals.discountTotal) }}</span></div>
          <div v-if="cart.coupon" class="r coupon-row">
            <span><i class="pi pi-ticket" /> {{ cart.coupon.name }} <span class="mono small">{{ cart.coupon.code }}</span>
              <Button icon="pi pi-times" text rounded size="small" severity="secondary" aria-label="Remove coupon" @click="cart.coupon = null" /></span>
            <span v-if="coupon.error" class="neg small">{{ coupon.error }}</span>
            <span v-else class="num neg">−{{ m(coupon.discount) }}</span>
          </div>
          <div v-if="cart.voucher" class="r coupon-row">
            <span><i class="pi pi-gift" /> Voucher <span class="mono small">{{ cart.voucher.code }}</span> · {{ m(cart.voucher.balance) }}
              <Button icon="pi pi-times" text rounded size="small" severity="secondary" aria-label="Remove voucher" @click="cart.voucher = null" /></span>
            <span class="small muted">pay with "Voucher"</span>
          </div>
          <div class="r"><span>Tax {{ (taxRate * 100).toFixed(2).replace(/\.?0+$/, '') }}%</span><span class="num">{{ m(totals?.taxTotal ?? 0) }}</span></div>
          <div v-if="cart.customer && maxRedeem > 0 && online" class="r redeem">
            <span>Use points <span class="muted small">(max {{ maxRedeem }})</span></span>
            <InputNumber v-model="cart.redeemPoints" :min="0" :max="maxRedeem" size="small" :input-style="{ width: '90px', textAlign: 'right' }" />
          </div>
          <div v-if="pointsDiscount" class="r"><span>Points</span><span class="num neg">−{{ m(pointsDiscount) }}</span></div>
          <div class="r total"><span>Total</span><span class="num">{{ m(amountDue) }}</span></div>
          <div v-if="khrRate && amountDue > 0" class="r khr-total" data-test="khr-total"><span class="small muted">in riel ({{ khrRate.toLocaleString() }})</span><span class="num">{{ formatKhr(usdToKhrUp(amountDue, khrRate)) }}</span></div>

          <div class="actions">
            <Button icon="pi pi-percentage" label="Discount" severity="secondary" outlined :disabled="!cart.lines.length" @click="openDiscount" />
            <Button icon="pi pi-pause" label="Hold" severity="secondary" outlined :disabled="!cart.lines.length" @click="hold" />
            <Button icon="pi pi-inbox" :label="`Held (${held.length})`" severity="secondary" outlined :disabled="!held.length" @click="heldDlg = true" />
            <Button icon="pi pi-trash" label="Clear" severity="danger" outlined :disabled="!cart.lines.length" @click="clearCart" />
          </div>
          <Button class="pay-btn" :label="`Pay ${m(amountDue)}`" icon="pi pi-wallet" size="large" :disabled="!cart.lines.length || !!priced.error" @click="openPay">
          </Button>
          <div class="keys small muted c" aria-label="F9 pay · F2 search · F4 member"><span><kbd>F9</kbd> pay</span><span><kbd>F2</kbd> search</span><span><kbd>F4</kbd> member</span></div>
        </div>
      </section>
    </div>

    <PosOptions v-model:visible="optDlg" :product="optProduct" :groups="optGroupsFor" :currency="cur" @add="onOptionsChosen" />
    <PosPayment v-model:visible="payment" :amount-due="amountDue" :currency="cur" :busy="paying" :store-id="app.currentStoreId!" :khqr-enabled="!!(store as any)?.khqrAccountId" :wallet-card="cart.wallet" :voucher="cart.voucher" :khr-rate="khrRate" @pay="complete" @progress="payProgress = $event" />

    <!-- Receipt after sale -->
    <Dialog v-model:visible="receiptDlg" header="Sale complete" modal :style="{ width: '420px' }" :breakpoints="{ '480px': '100vw' }" @hide="focusSearch">
      <div v-if="receipt">
        <div v-if="Number(receipt.changeDue)" class="change-big" data-test="change-big">Change <b>{{ Number(receipt.changeKhr) ? [Number(receipt.changeUsd) ? m(receipt.changeUsd) : '', formatKhr(Number(receipt.changeKhr))].filter(Boolean).join(' + ') : m(receipt.changeDue) }}</b></div>
        <Message v-if="receipt.offline" severity="warn" :closable="false" size="small">Offline: saved on this device and will upload automatically.</Message>
        <div class="receipt-box"><PosReceipt :sale="receipt" :currency="cur" /></div>
        <div class="row mt">
          <Button label="Print" icon="pi pi-print" severity="secondary" class="w-full" @click="printReceipt" />
          <Button label="New sale (Enter)" icon="pi pi-plus" class="w-full" autofocus @click="nextSale" />
        </div>
      </div>
    </Dialog>
    <div id="print-receipt"><PosReceipt v-if="receipt" :sale="receipt" :currency="cur" /></div>

    <!-- Member -->
    <Dialog v-model:visible="custDlg" header="Loyalty member" modal :style="{ width: '420px' }" @show="newCust.show = false">
      <form class="form" @submit.prevent="newCust.show ? createCustomer() : findCustomer()">
        <template v-if="!newCust.show">
          <div class="field"><label>Phone number or member card</label><InputText v-model="custCode" autofocus /></div>
          <Button type="submit" label="Find" icon="pi pi-search" :loading="custBusy" />
        </template>
        <template v-else>
          <Message severity="info" :closable="false" size="small">No member found. Register a new one:</Message>
          <div class="field"><label>Name *</label><InputText v-model="newCust.name" required autofocus /></div>
          <div class="field"><label>Phone</label><InputText v-model="newCust.phone" /></div>
          <div class="row" style="justify-content: flex-end">
            <Button label="Back" text severity="secondary" @click="newCust.show = false" />
            <Button type="submit" label="Register member" icon="pi pi-user-plus" />
          </div>
        </template>
      </form>
    </Dialog>

    <!-- Sale discount -->
    <Dialog v-model:visible="cashDlg" header="Cash in / out of the drawer" modal :style="{ width: '420px' }">
      <form class="form" @submit.prevent="saveCash">
        <SelectButton v-model="cashForm.type" :options="[{ l: 'Cash out', v: 'PAY_OUT' }, { l: 'Cash in', v: 'PAY_IN' }]" option-label="l" option-value="v" :allow-empty="false" />
        <SelectButton v-if="khrRate" v-model="cashForm.currency" :options="[{ l: 'Dollars', v: 'USD' }, { l: 'Riel', v: 'KHR' }]" option-label="l" option-value="v" :allow-empty="false" />
        <div class="field"><label>Amount</label>
          <InputNumber v-if="cashForm.currency === 'KHR'" v-model="cashForm.amount" :min="0" :step="100" prefix="៛" fluid autofocus />
          <InputNumber v-else v-model="cashForm.amount" :min="0" :min-fraction-digits="2" :max-fraction-digits="2" fluid autofocus />
        </div>
        <div class="field"><label>Reason *</label><InputText v-model="cashForm.reason" maxlength="200" :placeholder="cashForm.type === 'PAY_OUT' ? 'Ice delivery, bank drop…' : 'Extra float, change from the bank…'" /></div>
        <small v-if="cashForm.type === 'PAY_OUT' && auth.role === 'CASHIER' && (store as any)?.cashOutNeedsApproval !== false" class="muted">Cash out needs a manager PIN.</small>
        <div class="row" style="justify-content: flex-end">
          <Button label="Cancel" text severity="secondary" @click="cashDlg = false" />
          <Button type="submit" :label="cashForm.type === 'PAY_OUT' ? 'Take out' : 'Put in'" icon="pi pi-check" :loading="cashForm.busy" />
        </div>
      </form>
    </Dialog>
    <ManagerApproval v-model:visible="cashApprDlg" :store-id="app.currentStoreId" action="CASH_OUT" :amount="cashUsdValue" :reason="cashForm.reason"
      :message="`Cash out ${cashForm.currency === 'KHR' ? formatKhr(cashForm.amount) : m(cashForm.amount)}: ${cashForm.reason}`" @approved="(a) => doSaveCash(a.approvalId)" />
    <Dialog v-model:visible="xDlg" header="X report" modal :style="{ width: '440px' }" :breakpoints="{ '480px': '96vw' }">
      <RegisterReport v-if="xReport" :report="xReport" />
      <div class="row mt no-print" style="justify-content: flex-end"><Button label="Print" icon="pi pi-print" @click="printX" /></div>
    </Dialog>
    <ManagerApproval v-model:visible="approvalDlg" :store-id="app.currentStoreId" action="DISCOUNT" :percent="manualPercent"
      :message="`Discount of ${manualPercent}% (${m(manualAmount)}) is above the cashier limit of ${discountLimit}%.`" @approved="onApproved" />
    <Dialog v-model:visible="discDlg" header="Discount on whole sale" modal :style="{ width: '380px' }">
      <form class="form" @submit.prevent="applyDiscount">
        <SelectButton v-model="disc.type" :options="[{ l: 'Amount', v: 'amount' }, { l: 'Percent', v: 'percent' }]" option-label="l" option-value="v" :allow-empty="false" />
        <InputNumber v-model="disc.value" :min="0" :max="disc.type === 'percent' ? 100 : undefined" :max-fraction-digits="2" :suffix="disc.type === 'percent' ? ' %' : ''" fluid autofocus />
        <small v-if="auth.role === 'CASHIER' && discountLimit < 100" class="muted">Up to {{ discountLimit }}% without a manager. More needs a manager PIN when paying.</small>
        <div class="row" style="justify-content: flex-end">
          <Button label="Remove" text severity="secondary" @click="disc.value = 0; applyDiscount()" />
          <Button type="submit" label="Apply" />
        </div>
      </form>
    </Dialog>

    <!-- Line edit -->
    <Dialog v-model:visible="lineDlg" :header="cart.lines[lineEdit.index]?.name" modal :style="{ width: '380px' }">
      <form class="form" @submit.prevent="saveLine">
        <div class="field"><label>Quantity ({{ cart.lines[lineEdit.index]?.unit }})</label><InputNumber v-model="lineEdit.quantity" :min="0" :max-fraction-digits="3" fluid autofocus /></div>
        <div class="field"><label>Discount on this line (amount)</label><InputNumber v-model="lineEdit.discount" :min="0" :min-fraction-digits="2" :max-fraction-digits="2" fluid /></div>
        <div class="row" style="justify-content: flex-end">
          <Button label="Remove item" text severity="danger" @click="lineEdit.quantity = 0; saveLine()" />
          <Button type="submit" label="Save" />
        </div>
      </form>
    </Dialog>

    <!-- Held sales -->
    <Dialog v-model:visible="heldDlg" header="Held sales" modal :style="{ width: '460px' }">
      <div v-for="(h, i) in held" :key="h.clientRef" class="held">
        <div>
          <b>{{ h.lines.length }} item(s)</b> <span v-if="h.customer">· {{ h.customer.name }}</span>
          <div class="small muted">{{ dateTime(h.startedAt) }} · {{ h.lines.map((l) => l.name).slice(0, 3).join(', ') }}</div>
        </div>
        <div class="row">
          <Button icon="pi pi-trash" text rounded severity="danger" aria-label="Delete" @click="held.splice(i, 1)" />
          <Button label="Recall" size="small" @click="recall(i)" />
        </div>
      </div>
    </Dialog>

    <!-- Shift -->
    <Dialog v-model:visible="shiftDlg" header="Open your shift" modal :style="{ width: '380px' }">
      <form class="form" @submit.prevent="openShift">
        <div class="row" style="justify-content: space-between; gap: 10px">
          <p class="muted" style="margin: 0">Count the cash in the drawer before you start selling.</p>
          <KeyboardToggle label="Keypad" />
        </div>
        <div class="field"><label>{{ khrRate ? 'Opening cash (dollars)' : 'Opening cash' }}</label><InputNumber v-model="openingCash" :min="0" :min-fraction-digits="2" fluid autofocus
          :pt="noOsKeyboard" :class="{ 'pad-target': touch && shiftField === 'usd' }" @focus="shiftField = 'usd'" @click="shiftField = 'usd'" /></div>
        <div v-if="khrRate" class="field"><label>Opening riel</label><InputNumber v-model="openingKhr" :min="0" :step="100" prefix="៛" fluid
          :pt="noOsKeyboard" :class="{ 'pad-target': touch && shiftField === 'khr' }" @focus="shiftField = 'khr'" @click="shiftField = 'khr'" /></div>
        <NumPad v-if="touch" v-model="shiftPadValue" :decimals="shiftField === 'usd' ? 2 : 0" enter-label="Open" @enter="openShift" />
        <Button v-if="!touch" type="submit" label="Open shift" icon="pi pi-play" />
      </form>
    </Dialog>

    <!-- Online orders -->
    <Dialog v-model:visible="onlineDlg" header="Online orders" modal :style="{ width: '620px' }" :breakpoints="{ '680px': '100vw' }">
      <div v-if="!onlineOrders.length" class="muted c" style="padding: 20px">No online orders waiting. Paid KHQR orders go straight to the barista screen.</div>
      <div v-for="o in onlineOrders" :key="o.id" class="held">
        <div style="min-width: 0">
          <b>{{ o.customerName }}</b> <span class="muted small">{{ o.orderType === 'DINE_IN' ? 'Table ' + o.tableNo : 'Pickup' }} · {{ new Date(o.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}</span>
          <div class="small muted">{{ o.lines.map((l: any) => `${Number(l.quantity)}× ${l.name}`).join(', ') }}</div>
          <div class="small"><b>{{ m(o.total) }}</b> · <span :class="o.status === 'FAILED' ? 'neg' : ''">{{ o.status === 'PENDING_PAYMENT' ? 'Waiting for KHQR' : o.status === 'PAY_AT_COUNTER' ? 'Pays at the counter' : 'Problem: ' + o.error }}</span></div>
        </div>
        <div class="row" style="flex-shrink: 0">
          <Button icon="pi pi-times" text rounded severity="danger" aria-label="Cancel order" @click="cancelOnline(o)" />
          <Button v-if="o.status === 'PAY_AT_COUNTER'" label="Take payment" size="small" @click="takeOnline(o)" />
          <Button v-else label="Payment received" size="small" severity="success" :loading="onlineBusy === o.id" v-tooltip.left="'Check the KHQR payment arrived in your bank app first'" @click="confirmOnline(o)" />
        </div>
      </div>
    </Dialog>

    <!-- Gift voucher: sell -->
    <Dialog v-model:visible="sellDlg" header="Sell gift voucher" modal :style="{ width: '440px' }" @hide="focusSearch">
      <form v-if="sell.voucher" class="form" @submit.prevent="doSell">
        <div class="wallet-box row" style="justify-content: space-between"><span class="mono"><b>{{ sell.voucher.code }}</b></span><span>Value <b>{{ m(sell.voucher.value) }}</b></span></div>
        <div class="small muted">{{ sell.voucher.batch.name }}<span v-if="sell.voucher.expiresAt"> · expires {{ new Date(sell.voucher.expiresAt).toLocaleDateString() }}</span></div>
        <div class="field"><label>Customer pays {{ m(sell.voucher.value) }} by</label><SelectButton v-model="sell.method" :options="['CASH', 'KHQR', 'CARD', 'BANK_TRANSFER']" :option-label="(o: string) => humanize(o)" :allow-empty="false" /></div>
        <div v-if="sell.method !== 'CASH'" class="field"><label>Reference</label><InputText v-model="sell.reference" /></div>
        <Button type="submit" :label="`Received ${m(sell.voucher.value)}, activate voucher`" icon="pi pi-check" :loading="sell.busy" />
      </form>
    </Dialog>

    <!-- Wallet: activate -->
    <Dialog v-model:visible="actDlg" header="New wallet card" modal :style="{ width: '440px' }">
      <form v-if="act.card" class="form" @submit.prevent="doActivate">
        <Message severity="info" :closable="false">Card <span class="mono">{{ cardShort(act.card.cardNumber) }}</span> is not activated yet.</Message>
        <div class="field"><label>Serial number on the back *</label><InputText v-model="act.serial" required autofocus /></div>
        <div class="form-2">
          <div class="field"><label>Customer name *</label><InputText v-model="act.name" required /></div>
          <div class="field"><label>Phone</label><InputText v-model="act.phone" /></div>
        </div>
        <div class="field"><label>PIN (optional, 4-6 digits)</label><InputText v-model="act.pin" inputmode="numeric" maxlength="6" placeholder="The customer types it" /></div>
        <Button type="submit" label="Activate card" icon="pi pi-check" :loading="act.busy" />
      </form>
    </Dialog>

    <!-- Wallet: top up -->
    <Dialog v-model:visible="topDlg" header="Top up wallet card" modal :style="{ width: '460px' }" @hide="focusSearch">
      <form class="form" @submit.prevent="top.card ? doTopup() : findTopupCard()">
        <template v-if="!top.card">
          <div class="field"><label>Scan the wallet card</label><InputText v-model="top.code" autofocus placeholder="Card number" /></div>
          <Button type="submit" label="Find card" icon="pi pi-search" />
        </template>
        <template v-else>
          <div class="wallet-box row" style="justify-content: space-between">
            <span><b>{{ top.card.customer?.name ?? 'Wallet card' }}</b> <span class="mono muted">{{ cardShort(top.card.cardNumber) }}</span></span>
            <span>Balance <b>{{ m(top.card.balance) }}</b></span>
          </div>
          <div class="field"><label>Amount</label><InputNumber v-model="top.amount" :min="0.01" :min-fraction-digits="2" fluid autofocus /></div>
          <div class="row" style="flex-wrap: wrap"><Button v-for="a in [5, 10, 20, 50, 100]" :key="a" :label="m(a)" size="small" severity="secondary" outlined @click="top.amount = a" /></div>
          <div class="field"><label>Customer pays by</label><SelectButton v-model="top.method" :options="['CASH', 'KHQR', 'CARD', 'BANK_TRANSFER']" :option-label="(o: string) => humanize(o)" :allow-empty="false" /></div>
          <div v-if="top.method !== 'CASH'" class="field"><label>Reference (after checking the payment)</label><InputText v-model="top.reference" /></div>
          <div class="row" style="justify-content: space-between">
            <Button label="Other card" text severity="secondary" @click="top.card = null" />
            <Button type="submit" :label="`Top up ${m(top.amount)}`" icon="pi pi-check" :loading="top.busy" />
          </div>
          <small class="muted">New balance will be {{ m(Number(top.card.balance) + (top.amount || 0)) }}</small>
        </template>
      </form>
    </Dialog>

    <!-- Offline queue -->
    <Dialog v-model:visible="queueDlg" header="Sales waiting to upload" modal :style="{ width: '560px' }" :breakpoints="{ '640px': '100vw' }">
      <p class="muted" style="margin-top: 0">These sales were made offline and are saved on this device. They upload automatically when the internet is back.</p>
      <div v-for="q in queue" :key="q.clientRef" class="held">
        <div>
          <b class="mono">{{ q.receipt.receiptNo }}</b> · {{ m(q.receipt.total) }}
          <div class="small muted">{{ dateTime(q.createdAt) }} · {{ q.receipt.items.length }} item(s)</div>
          <div v-if="q.error" class="small neg">Rejected: {{ q.error }}</div>
        </div>
        <div class="row">
          <Button v-if="q.error" label="Retry" size="small" text @click="retryQueued(q.clientRef)" />
          <Button v-if="q.error" icon="pi pi-trash" text rounded severity="danger" aria-label="Delete" @click="discardQueued(q.clientRef)" />
        </div>
      </div>
      <div class="row mt" style="justify-content: flex-end">
        <Button label="Upload now" icon="pi pi-cloud-upload" :loading="syncingQueue" :disabled="!online" @click="syncNow" />
      </div>
    </Dialog>
  </div>
</template>

<style scoped>
.khr-total { font-weight: 700; color: var(--text-2); }
.pos-screen { height: calc(100vh / var(--pos-zoom, 1)); display: flex; flex-direction: column; background: var(--bg); }

/* Top bar */
.bar { height: 60px; flex-shrink: 0; display: flex; align-items: center; gap: 10px; padding: 0 14px; background: var(--surface); border-bottom: 1px solid var(--border); box-shadow: var(--shadow); position: relative; z-index: 2; }
.back { color: var(--text-2); padding: 6px; border-radius: 8px; }
.back:hover { background: var(--bg); }
.logo { width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; background: var(--p-primary-color); color: #fff; font-size: 17px; flex-shrink: 0; }
.title { display: flex; flex-direction: column; line-height: 1.2; min-width: 0; }
.title b { font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.who { font-size: 12px; color: var(--text-2); white-space: nowrap; }
.who .pi { font-size: 10px; }
.net { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700; padding: 4px 10px; border-radius: 999px; white-space: nowrap; }
.net .dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
.net.on { color: var(--good); background: color-mix(in srgb, var(--good) 12%, transparent); }
.net.off { color: #fff; background: var(--bad); animation: pulse 1.6s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: .75; } }
.spacer { flex: 1; }
.tools { display: flex; align-items: center; gap: 2px; background: var(--bg); border: 1px solid var(--border); border-radius: 12px; padding: 3px; }
.tools :deep(.p-button) { border-radius: 9px; }
.shift-chip :deep(.p-button-label) { white-space: nowrap; }

.body { flex: 1; min-height: 0; display: grid; grid-template-columns: 1fr 430px; }

/* Products */
.catalog-panel { display: flex; flex-direction: column; min-height: 0; min-width: 0; padding: 14px; gap: 10px; }
.search { display: flex; align-items: center; gap: 10px; background: var(--surface); border: 2px solid var(--border); border-radius: 14px; padding: 0 16px; box-shadow: var(--shadow); transition: border-color .15s; }
.search:focus-within { border-color: var(--p-primary-color); }
.search > .pi-search { color: var(--p-primary-color); font-size: 17px; }
.search-input { flex: 1; border: 0; outline: 0; background: transparent; color: var(--text); font: inherit; font-size: 17px; padding: 14px 0; min-width: 0; }
.search-input::placeholder { color: var(--text-3); }
.search-btn { border: 0; background: transparent; color: var(--text-3); width: 38px; height: 38px; border-radius: 10px; display: grid; place-items: center; cursor: pointer; flex: none; }
.search-btn:hover { background: var(--bg); color: var(--text); }
.search-btn.on { background: color-mix(in srgb, var(--p-primary-color) 16%, transparent); color: var(--p-primary-color); }
.pos-kb { flex: none; }
.pad-target :deep(input) { border-color: var(--p-primary-color); box-shadow: 0 0 0 3px color-mix(in srgb, var(--p-primary-color) 22%, transparent); }
.cats { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; flex-shrink: 0; scrollbar-width: none; }
.chip { border: 1px solid var(--border); background: var(--surface); color: var(--text); border-radius: 999px; padding: 8px 16px; font: inherit; font-weight: 600; cursor: pointer; white-space: nowrap; transition: background .1s; }
.chip:hover { border-color: var(--p-primary-color); }
.chip.on { background: var(--p-primary-color); border-color: var(--p-primary-color); color: #fff; }
.tiles { flex: 1; overflow-y: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(156px, 1fr)); gap: 10px; align-content: start; padding: 2px; }
.tile { --cat: #9a8b7f; position: relative; text-align: left; background: var(--surface); border: 1px solid var(--border); border-top: 4px solid var(--cat); border-radius: 14px; padding: 12px; min-height: 128px; display: flex; flex-direction: column; gap: 6px; cursor: pointer; font: inherit; color: var(--text); box-shadow: var(--shadow); transition: border-color .1s, transform .05s, box-shadow .15s; }
.tile:hover { border-color: var(--cat); box-shadow: 0 4px 14px rgba(60, 35, 15, .12); }
.tile:active { transform: scale(.97); }
.tile:focus-visible { outline: 3px solid color-mix(in srgb, var(--p-primary-color) 45%, transparent); outline-offset: 2px; }
.tile.out { opacity: .6; }
.tile-ini::before { content: attr(data-ini); }
.tile-ini { width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; font-weight: 800; font-size: 14px; color: var(--cat); background: color-mix(in srgb, var(--cat) 14%, transparent); }
.tile .name { font-weight: 650; line-height: 1.25; flex: 1; }
.tile .price { font-size: 18px; font-weight: 800; color: var(--text); }
.tile .meta { display: flex; justify-content: space-between; gap: 6px; font-size: 11px; color: var(--text-3); }
.tile .stock.low { color: var(--warn); font-weight: 700; }
.tile .stock.neg { color: var(--bad); font-weight: 700; }
.empty { grid-column: 1 / -1; text-align: center; padding: 40px 10px; display: grid; gap: 10px; justify-items: center; }
.empty-ic { width: 72px; height: 72px; border-radius: 50%; display: grid; place-items: center; background: var(--bg); color: var(--text-3); font-size: 30px; }

/* Cart */
.cart-panel { display: flex; flex-direction: column; min-height: 0; min-width: 0; background: var(--surface); border-left: 1px solid var(--border); }
.otype { display: flex; gap: 8px; align-items: center; padding: 10px 14px; border-bottom: 1px solid var(--border); }
.cust { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--border); min-height: 58px; }
.cust > .pi-user { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; background: color-mix(in srgb, var(--p-primary-color) 14%, transparent); color: var(--p-primary-color); }
.lines { flex: 1; overflow-y: auto; }
.line { display: grid; grid-template-columns: 1fr auto 78px 28px; gap: 8px; align-items: center; padding: 11px 14px; border-bottom: 1px solid var(--border); border-left: 4px solid transparent; cursor: default; }
.line.sel { background: color-mix(in srgb, var(--p-primary-color) 7%, transparent); border-left-color: var(--p-primary-color); }
.ln-name { font-weight: 650; line-height: 1.25; }
.promo { color: var(--good); font-weight: 600; margin-top: 2px; }
.ln-opts { color: var(--text-2); }
.ln-note { color: var(--warn); }
.tile-img { width: 100%; height: 76px; object-fit: cover; border-radius: 10px; }
.opt-mark { font-size: 11px; color: var(--text-3); margin-left: 6px; }
.wallet-line { color: var(--p-primary-color); font-weight: 600; }
.coupon-row { color: var(--p-primary-color); font-weight: 600; }
.qty { display: flex; align-items: center; gap: 4px; }
.qty button { width: 36px; height: 36px; border-radius: 10px; border: 1px solid var(--border); background: var(--bg); color: var(--text); cursor: pointer; display: grid; place-items: center; }
.qty button:hover { border-color: var(--p-primary-color); color: var(--p-primary-color); }
.qty button:active { transform: scale(.94); }
.ln-edit { width: 28px; height: 36px; border-radius: 8px; border: 0; background: transparent; color: var(--text-2); cursor: pointer; display: grid; place-items: center; }
.ln-edit:hover { background: var(--bg); }
.qty span { min-width: 32px; text-align: center; font-weight: 700; cursor: pointer; font-size: 15px; }
.ln-total { text-align: right; font-weight: 700; }
.sum { border-top: 1px solid var(--border); padding: 12px 14px 10px; display: grid; gap: 6px; background: var(--surface); box-shadow: 0 -4px 12px rgba(60, 35, 15, .04); }
.r { display: flex; justify-content: space-between; align-items: center; }
.r.total { font-size: 26px; font-weight: 800; margin-top: 4px; padding-top: 8px; border-top: 1px dashed var(--border); }
.actions { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-top: 6px; }
.actions :deep(.p-button) { padding: 8px 4px; font-size: 12.5px; flex-direction: column; gap: 3px; }
.actions :deep(.p-button-icon) { margin: 0; font-size: 15px; }
.pay-btn { width: 100%; font-size: 21px; font-weight: 800; padding: 18px; margin-top: 4px; border-radius: 14px; box-shadow: 0 6px 16px color-mix(in srgb, var(--p-primary-color) 35%, transparent); }
.keys { display: flex; justify-content: center; gap: 14px; }
kbd { font: inherit; font-size: 11px; font-weight: 700; border: 1px solid var(--border); border-bottom-width: 2px; border-radius: 5px; padding: 0 5px; background: var(--bg); color: var(--text-2); }
.c { text-align: center; }
.receipt-box { background: var(--bg); border-radius: 12px; padding: 16px; max-height: 50vh; overflow-y: auto; margin-top: 10px; }
.change-big { text-align: center; font-size: 20px; padding: 12px; border-radius: 12px; background: color-mix(in srgb, var(--good) 14%, var(--surface)); margin-bottom: 6px; }
.change-big b { font-size: 30px; display: block; }
.wallet-box { background: color-mix(in srgb, var(--p-primary-color) 10%, var(--surface)); border-radius: 12px; padding: 12px 14px; }
.held { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--border); }
#print-receipt { display: none; }
/* Smaller laptops: tool buttons show icons only (the name is in the tooltip) */
@media (max-width: 1280px) {
  .tools :deep(.p-button-label) { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  .tools :deep(.p-button) { padding-inline: 9px; }
  .who { display: none; }
  .body { grid-template-columns: 1fr 390px; }
}
@media (max-width: 900px) {
  .pos-screen { height: auto; min-height: 100vh; }
  .bar { height: auto; flex-wrap: wrap; padding: 8px 12px; }
  .body { grid-template-columns: 1fr; }
  .tiles { max-height: 46vh; grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); }
  .cart-panel { border-left: 0; border-top: 1px solid var(--border); }
  .lines { max-height: 40vh; }
}
</style>

<style>
@media print {
  body.printing-pos * { visibility: hidden; }
  body.printing-pos #print-receipt, body.printing-pos #print-receipt * { visibility: visible; color: #000 !important; }
  body.printing-pos #print-receipt { display: block !important; position: absolute; left: 0; top: 0; width: 72mm; }
  @page { size: 80mm auto; margin: 4mm; }
}
</style>
