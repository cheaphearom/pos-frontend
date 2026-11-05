<script setup lang="ts">
/** Online ordering for customers' phones: /order/PP01 (pickup) or /order/PP01?table=5 (table QR). */
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import PosOptions, { type ChosenOption, type OptionGroup } from '@/components/pos/PosOptions.vue';
import { myOrders, pub } from '@/online/publicApi';
import { optionsText } from '@/utils/modifiers';

const route = useRoute();
const router = useRouter();
const code = String(route.params.code).toUpperCase();
const table = route.query.table ? String(route.query.table).slice(0, 20) : '';

const menu = ref<any>(null);
const loadError = ref('');
const category = ref<string | null>(null);
const money = (v: number | string) => new Intl.NumberFormat('en-US', { style: 'currency', currency: menu.value?.store.currency ?? 'USD' }).format(Number(v));

interface CartLine { productId: string; name: string; quantity: number; modifiers: ChosenOption[]; note: string; unitPrice: number }
const CART = `order.cart:${code}`;
const cart = ref<CartLine[]>(read(CART, []));
const form = reactive(read(`order.form`, { customerName: '', phone: '', note: '', couponCode: '', payMethod: 'KHQR' as 'KHQR' | 'COUNTER' }));
watch(cart, (c) => save(CART, c), { deep: true });
watch(form, (f) => save('order.form', { ...f, note: '', couponCode: '' }), { deep: true });
function read<T>(k: string, d: T): T { try { return JSON.parse(localStorage.getItem(k) ?? '') ?? d; } catch { return d; } }
function save(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } }

const products = computed(() => (menu.value?.products ?? []).filter((p: any) => !category.value || p.categoryId === category.value));
const count = computed(() => cart.value.reduce((s, l) => s + l.quantity, 0));
const estimate = computed(() => cart.value.reduce((s, l) => s + l.unitPrice * l.quantity, 0));

// Options sheet (same component as the POS)
const optDlg = ref(false);
const optProduct = ref<any>(null);
const optGroups = computed<OptionGroup[]>(() => (optProduct.value?.modifierGroupIds ?? []).map((id: string) => menu.value.groups.find((g: any) => g.id === id)).filter(Boolean));
function tap(p: any) {
  if (p.soldOut) return;
  if (p.modifierGroupIds.length) {
    optProduct.value = p;
    optDlg.value = true;
  } else addLine(p, 1, [], '');
}
function addLine(p: any, quantity: number, modifiers: ChosenOption[], note: string) {
  const same = cart.value.find((l) => l.productId === p.id && l.note === note && l.modifiers.map((m) => m.id).join() === modifiers.map((m) => m.id).join());
  if (same) same.quantity += quantity;
  else cart.value.push({ productId: p.id, name: p.name, quantity, modifiers, note, unitPrice: Number(p.price) + modifiers.reduce((s, m) => s + Number(m.price), 0) });
  added.value = p.name;
  setTimeout(() => (added.value = ''), 1500);
}
const added = ref('');

// Cart sheet with the server's exact prices
const sheet = ref(false);
const quote = ref<any>(null);
const quoteError = ref('');
const quoting = ref(false);
let qTimer: ReturnType<typeof setTimeout> | undefined;
const request = () => cart.value.map((l) => ({ productId: l.productId, quantity: l.quantity, modifiers: l.modifiers.map((m) => m.id), note: l.note || undefined }));
function requote() {
  clearTimeout(qTimer);
  if (!cart.value.length) { quote.value = null; return; }
  qTimer = setTimeout(async () => {
    quoting.value = true;
    try {
      quote.value = await pub(`/stores/${code}/quote`, { items: request(), couponCode: form.couponCode.trim() || undefined });
      quoteError.value = '';
    } catch (e) {
      quoteError.value = (e as Error).message;
      if (form.couponCode && /coupon/i.test(quoteError.value)) {
        // keep the cart usable: show the coupon problem and price without it
        const bad = quoteError.value;
        form.couponCode = '';
        quoteError.value = bad;
      }
    } finally { quoting.value = false; }
  }, 300);
}
watch([cart, sheet], () => sheet.value && requote(), { deep: true });
const couponInput = ref('');
function applyCoupon() {
  form.couponCode = couponInput.value.trim();
  requote();
}
function changeQty(i: number, d: number) {
  cart.value[i].quantity += d;
  if (cart.value[i].quantity <= 0) cart.value.splice(i, 1);
}

const placing = ref(false);
const placeError = ref('');
async function place() {
  placeError.value = '';
  if (!form.customerName.trim()) { placeError.value = 'Please enter your name'; return; }
  placing.value = true;
  try {
    const r = await pub(`/stores/${code}/orders`, {
      items: request(), customerName: form.customerName.trim(), phone: form.phone.trim() || undefined, note: form.note.trim() || undefined,
      couponCode: form.couponCode || undefined, tableNo: table || undefined, payMethod: form.payMethod,
    });
    myOrders.add(r.token, code);
    cart.value = [];
    router.push(`/order/status/${r.token}?store=${code}${table ? '&table=' + encodeURIComponent(table) : ''}`);
  } catch (e) { placeError.value = (e as Error).message; } finally { placing.value = false; }
}

onMounted(async () => {
  document.title = 'Order online';
  try {
    menu.value = await pub(`/stores/${code}/menu`);
    document.title = `Order · ${menu.value.store.name}`;
    if (!menu.value.store.khqr) form.payMethod = 'COUNTER';
    // drop items no longer on the menu
    cart.value = cart.value.filter((l) => menu.value.products.some((p: any) => p.id === l.productId));
  } catch (e) { loadError.value = (e as Error).message; }
});
const recent = myOrders.list().filter((o) => o.store === code && Date.now() - new Date(o.at).getTime() < 6 * 3600_000);
</script>

<template>
  <div class="shop">
    <div v-if="loadError" class="center"><h2>Sorry</h2><p>{{ loadError }}</p></div>
    <template v-else-if="menu">
      <header class="top">
        <div>
          <div class="sname">{{ menu.store.name }}</div>
          <div class="small">{{ table ? `Table ${table} · we bring it to you` : 'Order ahead · pick up at the counter' }}</div>
        </div>
        <RouterLink v-if="recent.length" :to="`/order/status/${recent[0].token}`" class="mine"><i class="pi pi-receipt" /> My order</RouterLink>
      </header>
      <nav class="cats">
        <button :class="{ on: !category }" @click="category = null">All</button>
        <button v-for="c in menu.categories" :key="c.id" :class="{ on: category === c.id }" @click="category = c.id">{{ c.name }}</button>
      </nav>
      <main class="items">
        <button v-for="p in products" :key="p.id" class="item" :class="{ out: p.soldOut }" @click="tap(p)">
          <img v-if="p.imageUrl" :src="p.imageUrl" alt="" loading="lazy" />
          <div v-else class="ph"><i class="pi pi-shopping-bag" /></div>
          <div class="info">
            <b>{{ p.name }}</b>
            <span v-if="p.description" class="desc">{{ p.description }}</span>
            <span class="price">{{ p.soldOut ? 'Sold out' : money(p.price) }}<span v-if="p.modifierGroupIds.length && !p.soldOut" class="opts"> · options</span></span>
          </div>
          <span class="add"><i class="pi pi-plus" /></span>
        </button>
      </main>
      <Transition name="fade"><div v-if="added" class="toast"><i class="pi pi-check" /> {{ added }} added</div></Transition>
      <button v-if="count" class="cartbar" @click="sheet = true">
        <span class="badge">{{ count }}</span> View order <b>{{ money(estimate) }}</b>
      </button>

      <PosOptions v-model:visible="optDlg" :product="optProduct" :groups="optGroups" :currency="menu.store.currency" @add="(e) => addLine(optProduct, e.quantity, e.modifiers, e.note)" />

      <Drawer v-model:visible="sheet" position="bottom" header="Your order" style="height: 92vh">
        <div class="sheet">
          <div v-for="(l, i) in cart" :key="i" class="line">
            <div class="lmain">
              <b>{{ l.name }}</b>
              <div v-if="l.modifiers.length" class="small muted">{{ optionsText(l.modifiers) }}</div>
              <div v-if="l.note" class="small note">“{{ l.note }}”</div>
            </div>
            <div class="qty"><button aria-label="Less" @click="changeQty(i, -1)">−</button><b>{{ l.quantity }}</b><button aria-label="More" @click="changeQty(i, 1)">+</button></div>
            <div class="ltotal">{{ quote?.lines?.[i] ? money(quote.lines[i].total) : money(l.unitPrice * l.quantity) }}</div>
          </div>
          <div v-if="!cart.length" class="center muted">Your order is empty</div>

          <template v-if="cart.length">
            <div class="row coupon">
              <InputText v-model="couponInput" placeholder="Coupon code" size="small" style="flex: 1; text-transform: uppercase" />
              <Button label="Apply" size="small" severity="secondary" @click="applyCoupon" />
            </div>
            <div v-if="quote" class="totals">
              <div><span>Subtotal</span><span>{{ money(quote.subtotal) }}</span></div>
              <div v-if="Number(quote.discountTotal)" class="save"><span>Discount<template v-if="quote.coupon"> ({{ quote.coupon.code }})</template></span><span>−{{ money(quote.discountTotal) }}</span></div>
              <div><span>Tax</span><span>{{ money(quote.taxTotal) }}</span></div>
              <div class="grand"><span>Total</span><span>{{ money(quote.total) }}</span></div>
            </div>
            <Message v-if="quoteError" severity="warn" :closable="false" size="small">{{ quoteError }}</Message>

            <div class="form">
              <div class="field"><label>Your name *</label><InputText v-model="form.customerName" maxlength="80" autocomplete="name" /></div>
              <div class="field"><label>Phone <span class="hint">(members earn points)</span></label><InputText v-model="form.phone" inputmode="tel" maxlength="20" autocomplete="tel" /></div>
              <div class="field"><label>Note</label><InputText v-model="form.note" maxlength="200" placeholder="Anything we should know?" /></div>
              <div class="field">
                <label>Payment</label>
                <div class="pay">
                  <button v-if="menu.store.khqr" :class="{ on: form.payMethod === 'KHQR' }" @click="form.payMethod = 'KHQR'"><i class="pi pi-qrcode" /> KHQR now</button>
                  <button :class="{ on: form.payMethod === 'COUNTER' }" @click="form.payMethod = 'COUNTER'"><i class="pi pi-wallet" /> Pay at counter</button>
                </div>
              </div>
            </div>
            <Message v-if="placeError" severity="error" :closable="false" size="small">{{ placeError }}</Message>
            <Button class="placebtn" :label="quote ? `Place order · ${money(quote.total)}` : 'Place order'" :loading="placing || quoting" :disabled="!quote" @click="place" />
          </template>
        </div>
      </Drawer>
    </template>
    <div v-else class="center"><i class="pi pi-spin pi-spinner" style="font-size: 28px" /></div>
  </div>
</template>

<style scoped>
.shop { min-height: 100vh; background: var(--bg); padding-bottom: 90px; max-width: 720px; margin: 0 auto; }
.top { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 18px 16px 10px; background: var(--surface); }
.sname { font-size: 20px; font-weight: 800; }
.small { font-size: 13px; color: var(--text-2); }
.mine { font-size: 14px; font-weight: 600; text-decoration: none; white-space: nowrap; }
.cats { display: flex; gap: 8px; overflow-x: auto; padding: 10px 16px; position: sticky; top: 0; background: var(--surface); z-index: 2; border-bottom: 1px solid var(--border); scrollbar-width: none; }
.cats button { border: 1px solid var(--border); background: var(--surface); color: var(--text); border-radius: 999px; padding: 8px 14px; font: inherit; font-weight: 600; white-space: nowrap; }
.cats button.on { background: var(--p-primary-color); border-color: var(--p-primary-color); color: #fff; }
.items { display: grid; gap: 10px; padding: 12px 16px; }
.item { display: grid; grid-template-columns: 76px 1fr 36px; gap: 12px; align-items: center; text-align: left; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 10px; font: inherit; color: var(--text); }
.item img, .ph { width: 76px; height: 76px; border-radius: 10px; object-fit: cover; }
.ph { display: grid; place-items: center; background: var(--bg); color: var(--text-3); font-size: 22px; }
.item.out { opacity: .5; }
.info { display: grid; gap: 4px; }
.desc { font-size: 13px; color: var(--text-2); }
.price { font-weight: 700; color: var(--p-primary-color); }
.opts { color: var(--text-3); font-weight: 500; font-size: 13px; }
.add { width: 34px; height: 34px; border-radius: 50%; background: var(--p-primary-color); color: #fff; display: grid; place-items: center; }
.cartbar { position: fixed; left: 50%; transform: translateX(-50%); bottom: 16px; width: min(688px, calc(100% - 32px)); border: 0; border-radius: 14px; background: var(--p-primary-color); color: #fff; font: inherit; font-size: 17px; padding: 16px; display: flex; gap: 10px; align-items: center; justify-content: center; box-shadow: 0 8px 24px rgba(0, 0, 0, .25); z-index: 5; }
.badge { background: #fff; color: var(--p-primary-color); border-radius: 999px; min-width: 26px; padding: 2px 8px; font-weight: 800; }
.toast { position: fixed; bottom: 84px; left: 50%; transform: translateX(-50%); background: #1d1f23; color: #fff; padding: 8px 14px; border-radius: 999px; font-size: 14px; z-index: 6; }
.sheet { display: grid; gap: 12px; max-width: 680px; margin: 0 auto; }
.line { display: grid; grid-template-columns: 1fr auto 72px; gap: 10px; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 10px; }
.note { color: #b45309; }
.qty { display: flex; align-items: center; gap: 10px; }
.qty button { width: 32px; height: 32px; border-radius: 50%; border: 1px solid var(--border); background: var(--surface); color: var(--text); font-size: 18px; }
.ltotal { text-align: right; font-weight: 700; }
.coupon { gap: 8px; }
.totals { display: grid; gap: 4px; }
.totals div { display: flex; justify-content: space-between; }
.totals .save { color: var(--good); }
.grand { font-size: 20px; font-weight: 800; border-top: 1px solid var(--border); padding-top: 6px; }
.pay { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.pay button { border: 1px solid var(--border); background: var(--surface); color: var(--text); border-radius: 12px; padding: 14px; font: inherit; font-weight: 700; display: flex; gap: 8px; justify-content: center; align-items: center; }
.pay button.on { border-color: var(--p-primary-color); color: var(--p-primary-color); background: color-mix(in srgb, var(--p-primary-color) 10%, var(--surface)); }
.placebtn { width: 100%; padding: 16px; font-size: 18px; }
.center { text-align: center; padding: 60px 20px; }
.fade-enter-active, .fade-leave-active { transition: opacity .3s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
