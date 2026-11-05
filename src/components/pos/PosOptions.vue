<script setup lang="ts">
/** Choose drink options (size, sugar, ice, milk, extras) before adding to the cart. */
import { computed, reactive, ref, watch } from 'vue';
import { money } from '@/utils/format';

export interface OptionGroup { id: string; name: string; minSelect: number; maxSelect: number; options: { id: string; name: string; priceDelta: string; isDefault: boolean }[] }
export interface ChosenOption { id: string; group: string; option: string; price: string }

const props = defineProps<{ product: { name: string; price: string; unit: string } | null; groups: OptionGroup[]; currency: string }>();
const emit = defineEmits<{ add: [{ modifiers: ChosenOption[]; quantity: number; note: string }] }>();
const visible = defineModel<boolean>('visible', { default: false });

const picked = reactive<Record<string, string[]>>({});
const quantity = ref(1);
const note = ref('');
const tried = ref(false);

watch(visible, (v) => {
  if (!v) return;
  for (const k of Object.keys(picked)) delete picked[k];
  for (const g of props.groups) picked[g.id] = g.options.filter((o) => o.isDefault).slice(0, g.maxSelect).map((o) => o.id);
  quantity.value = 1;
  note.value = '';
  tried.value = false;
});

function toggle(g: OptionGroup, id: string) {
  const cur = picked[g.id] ?? [];
  if (g.maxSelect === 1) picked[g.id] = cur[0] === id && g.minSelect === 0 ? [] : [id];
  else if (cur.includes(id)) picked[g.id] = cur.filter((x) => x !== id);
  else if (cur.length < g.maxSelect) picked[g.id] = [...cur, id];
}
const missing = computed(() => props.groups.filter((g) => (picked[g.id]?.length ?? 0) < g.minSelect));
const chosen = computed<ChosenOption[]>(() =>
  props.groups.flatMap((g) => (picked[g.id] ?? []).map((id) => {
    const o = g.options.find((x) => x.id === id)!;
    return { id: o.id, group: g.name, option: o.name, price: o.priceDelta };
  })),
);
const unit = computed(() => Number(props.product?.price ?? 0) + chosen.value.reduce((s, o) => s + Number(o.price), 0));

function add() {
  tried.value = true;
  if (missing.value.length) return;
  emit('add', { modifiers: chosen.value, quantity: quantity.value, note: note.value.trim() });
  visible.value = false;
}
</script>

<template>
  <Dialog v-model:visible="visible" :header="product?.name" modal :style="{ width: '620px' }" :breakpoints="{ '680px': '100vw' }">
    <div class="opts">
      <section v-for="g in groups" :key="g.id" class="grp" :class="{ miss: tried && missing.includes(g) }">
        <div class="g-head">
          <b>{{ g.name }}</b>
          <span class="small muted">{{ g.minSelect ? 'Required' : 'Optional' }}{{ g.maxSelect > 1 ? ` · up to ${g.maxSelect}` : '' }}</span>
        </div>
        <div class="choices">
          <button v-for="o in g.options" :key="o.id" type="button" class="choice" :class="{ on: picked[g.id]?.includes(o.id) }" @click="toggle(g, o.id)">
            {{ o.name }}<span v-if="Number(o.priceDelta)" class="delta">{{ Number(o.priceDelta) > 0 ? '+' : '' }}{{ money(o.priceDelta, currency) }}</span>
          </button>
        </div>
      </section>
      <div class="field"><label>Note for the barista</label><InputText v-model="note" maxlength="200" placeholder="e.g. less sweet, very hot" /></div>
      <div class="foot">
        <div class="qty">
          <Button icon="pi pi-minus" rounded outlined aria-label="Less" :disabled="quantity <= 1" @click="quantity--" />
          <b>{{ quantity }}</b>
          <Button icon="pi pi-plus" rounded outlined aria-label="More" @click="quantity++" />
        </div>
        <Button :label="`Add ${money(unit * quantity, currency)}`" icon="pi pi-plus" size="large" @click="add" />
      </div>
      <small v-if="tried && missing.length" class="neg">Choose {{ missing.map((g) => g.name).join(', ') }}</small>
    </div>
  </Dialog>
</template>

<style scoped>
.opts { display: grid; gap: 14px; }
.grp { display: grid; gap: 8px; padding: 2px; border-radius: 10px; }
.grp.miss { outline: 2px solid var(--bad); outline-offset: 4px; }
.g-head { display: flex; justify-content: space-between; align-items: baseline; }
.choices { display: flex; flex-wrap: wrap; gap: 8px; }
.choice { border: 1px solid var(--border); background: var(--surface); color: var(--text); border-radius: 10px; padding: 10px 14px; font: inherit; font-weight: 600; cursor: pointer; min-width: 80px; }
.choice.on { border-color: var(--p-primary-color); background: color-mix(in srgb, var(--p-primary-color) 14%, var(--surface)); color: var(--p-primary-color); }
.delta { font-weight: 500; margin-left: 6px; font-size: 13px; }
.foot { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.qty { display: flex; align-items: center; gap: 14px; font-size: 20px; }
</style>
