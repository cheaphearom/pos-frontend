/**
 * Khmer / English interface.
 *
 * The app is written in English. In Khmer mode a small translator swaps visible English text (text, placeholders,
 * button labels, tooltips, page titles) for Khmer from one dictionary file (./km.ts), on every screen at once,
 * including PrimeVue components and messages. Text without a translation stays in English, so the dictionary can
 * grow over time without touching the screens. Data (product names, customer names) is not translated here:
 * products and categories have their own Khmer name field.
 */
import { ref } from 'vue';
import { KM_EXACT, KM_PATTERNS } from './km';

export type Lang = 'en' | 'km';
const KEY = 'ui.lang';

function initial(): Lang {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'km' || v === 'en') return v;
  } catch { /* private mode */ }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('km') ? 'km' : 'en';
}

export const lang = ref<Lang>(initial());

const exact = new Map<string, string>(Object.entries(KM_EXACT));

/** Khmer for one English string, or null when there is none. Surrounding spaces are kept. */
export function translate(s: string): string | null {
  const trimmed = s.trim();
  if (!trimmed || !/[A-Za-z]/.test(trimmed)) return null;
  let out = exact.get(trimmed) ?? exact.get(trimmed.replace(/\s+/g, ' '));
  if (out === undefined) {
    for (const [re, rep] of KM_PATTERNS) {
      const m = trimmed.match(re);
      if (m) { out = typeof rep === 'function' ? rep(...(m as unknown as string[])) : trimmed.replace(re, rep); break; }
    }
  }
  if (out === undefined) return null;
  return s.replace(trimmed, out);
}

/** For strings built in code (confirm boxes, document titles…). */
export const t = (s: string) => (lang.value === 'km' ? translate(s) ?? s : s);

// ───────────── DOM translator ─────────────
type Rec = { src: string; out: string };
const textRec = new WeakMap<Text, Rec>();
const attrRec = new WeakMap<Element, Record<string, Rec>>();
const ATTRS = ['placeholder', 'aria-label', 'title'];
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE']);

function skipped(el: Element | null): boolean {
  for (let e = el; e; e = e.parentElement) {
    if (SKIP.has(e.tagName) || (e as HTMLElement).dataset?.noI18n !== undefined || (e as HTMLElement).isContentEditable) return true;
  }
  return false;
}

function doText(n: Text) {
  const rec = textRec.get(n);
  if (lang.value !== 'km') {
    if (rec && n.data === rec.out) n.data = rec.src;
    textRec.delete(n);
    return;
  }
  if (rec && n.data === rec.out) return; // already ours
  if (skipped(n.parentElement)) return;
  const tr = translate(n.data);
  if (tr !== null && tr !== n.data) {
    textRec.set(n, { src: n.data, out: tr });
    n.data = tr;
  } else textRec.delete(n);
}

function doAttrs(el: Element) {
  let recs = attrRec.get(el);
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (v === null) continue;
    const rec = recs?.[a];
    if (lang.value !== 'km') {
      if (rec && v === rec.out) el.setAttribute(a, rec.src);
      if (recs) delete recs[a];
      continue;
    }
    if (rec && v === rec.out) continue;
    const tr = translate(v);
    if (tr !== null && tr !== v) {
      recs ??= {};
      recs[a] = { src: v, out: tr };
      attrRec.set(el, recs);
      el.setAttribute(a, tr);
    }
  }
}

function walk(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) return doText(root as Text);
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
  if (root.nodeType === Node.ELEMENT_NODE) {
    if (skipped(root as Element)) return;
    doAttrs(root as Element);
  }
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) doText(n as Text);
    else doAttrs(n as Element);
  }
}

let observer: MutationObserver | null = null;

function apply() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = lang.value;
  document.documentElement.classList.toggle('lang-km', lang.value === 'km');
  walk(document.documentElement);
}

/** Start translating the page (call once at start-up). */
export function startTranslator() {
  if (typeof MutationObserver === 'undefined' || observer) return;
  observer = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') doText(m.target as Text);
      else if (m.type === 'attributes') doAttrs(m.target as Element);
      else m.addedNodes.forEach(walk);
    }
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  apply();
  // Another window of the app (e.g. the customer display) changed the language.
  window.addEventListener('storage', (e) => {
    if (e.key === KEY && (e.newValue === 'km' || e.newValue === 'en') && e.newValue !== lang.value) { lang.value = e.newValue; apply(); }
  });
}

export function setLang(l: Lang) {
  lang.value = l;
  try { localStorage.setItem(KEY, l); } catch { /* ignore */ }
  apply();
}

/** Khmer name of a product / category when the interface is in Khmer and one is set. */
export const localName = (x: { name: string; nameKm?: string | null } | null | undefined) => (x ? (lang.value === 'km' && x.nameKm ? x.nameKm : x.name) : '');
