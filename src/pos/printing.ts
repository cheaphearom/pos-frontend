// Copyright (c) 2026 Chea Phearom. All rights reserved.
// Proprietary and confidential: see the LICENSE file.
/**
 * Printing slips (customer receipt, cashier copy, kitchen ticket) to named printers through QZ Tray, a small
 * program installed on the till computer (https://qz.io). Each slip is drawn as a picture of what is on screen, so
 * Khmer text and the store's look print exactly, then sent to the chosen printer without a print window.
 *
 * The server signs every request (GET /print/qz-certificate, POST /print/qz-sign), so QZ Tray does not ask
 * "Allow?" once its certificate is trusted. Without QZ Tray the slips go to the browser's normal printing
 * (the default printer), one after the other.
 *
 * Which printer is which is kept on this computer only (each till has its own printers).
 */
import { ref } from 'vue';
import qz from 'qz-tray';
import { toPng } from 'html-to-image';
import { api } from '@/api/client';
import { printElement } from '@/utils/print';

export type QzState = 'off' | 'connecting' | 'on' | 'missing';
export const qzState = ref<QzState>('off');

const KEY = 'pos.printers';
export interface TillPrinters { receipt: string | null; kitchen: string | null }
export function loadPrinters(): TillPrinters {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return { receipt: v?.receipt ?? null, kitchen: v?.kitchen ?? null };
  } catch { return { receipt: null, kitchen: null }; }
}
export function savePrinters(p: TillPrinters) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private window */ }
}

let securitySet = false;
function setupSecurity() {
  if (securitySet) return;
  securitySet = true;
  // The certificate and each signature come from the server; if it has none, QZ Tray prints but asks "Allow?".
  qz.security.setCertificatePromise((resolve: (c?: string) => void) => {
    api.get<string>('/print/qz-certificate').then((c) => resolve(typeof c === 'string' && c.includes('BEGIN') ? c : undefined), () => resolve());
  });
  qz.security.setSignatureAlgorithm('SHA512');
  qz.security.setSignaturePromise((toSign: string) => (resolve: (s?: string) => void) => {
    api.post<string>('/print/qz-sign', { request: toSign }).then((s) => resolve(typeof s === 'string' ? s : undefined), () => resolve());
  });
}

/** Connects to QZ Tray on this computer. Returns false (and qzState 'missing') when it is not installed or not running. */
export async function connectQz(): Promise<boolean> {
  if (qz.websocket.isActive()) { qzState.value = 'on'; return true; }
  setupSecurity();
  qzState.value = 'connecting';
  try {
    await qz.websocket.connect({ retries: 0, delay: 0 });
    qzState.value = 'on';
    qz.websocket.setClosedCallbacks(() => (qzState.value = 'off'));
    return true;
  } catch {
    qzState.value = 'missing';
    return false;
  }
}

export async function listPrinters(): Promise<string[]> {
  if (!(await connectQz())) return [];
  const found = await qz.printers.find();
  return Array.isArray(found) ? found : [found];
}

/** A picture of the slip, 2× sharp, white background. */
async function slipImage(el: HTMLElement): Promise<string> {
  const png = await toPng(el, { pixelRatio: 2, backgroundColor: '#ffffff', cacheBust: true });
  return png.slice(png.indexOf(',') + 1);
}

/** Prints one slip on a named printer (80 mm roll, 72 mm printable). */
export async function printSlipTo(printer: string, el: HTMLElement) {
  const data = await slipImage(el);
  const config = qz.configs.create(printer, { units: 'mm', size: { width: 72 }, margins: 0, scaleContent: true, colorType: 'grayscale', interpolation: 'nearest-neighbor' });
  await qz.print(config, [{ type: 'pixel', format: 'image', flavor: 'base64', data }]);
}

export interface Slip { kind: 'customer' | 'cashier' | 'kitchen'; el: HTMLElement }

/**
 * Prints the slips: the kitchen ticket on the kitchen printer, the others on the receipt printer.
 * With QZ Tray off or no printer chosen, those slips go to the browser's printing instead (default printer).
 * Returns what went where, for a message to the cashier.
 */
export async function printSlips(slips: Slip[]): Promise<{ direct: number; browser: number }> {
  const printers = loadPrinters();
  const browser: HTMLElement[] = [];
  let direct = 0;
  const on = slips.length && (printers.receipt || printers.kitchen) ? await connectQz() : false;
  for (const s of slips) {
    const target = s.kind === 'kitchen' ? printers.kitchen ?? printers.receipt : printers.receipt;
    if (on && target) {
      await printSlipTo(target, s.el);
      direct++;
    } else browser.push(s.el);
  }
  if (browser.length) {
    // one print job, a page per slip
    const box = document.createElement('div');
    browser.forEach((el, i) => {
      const page = document.createElement('div');
      page.style.breakAfter = i < browser.length - 1 ? 'page' : 'auto';
      page.innerHTML = el.outerHTML;
      box.appendChild(page);
    });
    printElement(box);
  }
  return { direct, browser: browser.length };
}
