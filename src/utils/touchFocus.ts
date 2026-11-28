// Copyright (c) 2026 Chea Phearom. All rights reserved.
// Proprietary and confidential: see the LICENSE file.
/**
 * Touchscreen tills: the device's own keyboard appears only when the cashier taps a field.
 *
 * The POS moves the cursor to the search box after each product tap and into the first field of a pop-up, so
 * barcode scanners and physical keyboards can type at once. On a touchscreen that same focus made the device
 * keyboard slide up and cover the screen. Here, a field focused by the app (not by a tap) gets inputmode="none"
 * (no device keyboard, scanners still type); tapping it brings the keyboard up as usual.
 */
const MARK = 'data-auto-im';
let lastTap: { el: EventTarget | null; at: number } = { el: null, at: 0 };

const isField = (el: EventTarget | null): el is HTMLInputElement | HTMLTextAreaElement =>
  (el instanceof HTMLInputElement && !['button', 'checkbox', 'radio', 'range', 'color', 'file', 'submit', 'reset'].includes(el.type)) ||
  el instanceof HTMLTextAreaElement;

export function installTouchFocus() {
  if (typeof window === 'undefined' || !window.matchMedia?.('(pointer: coarse)').matches) return;

  document.addEventListener('pointerdown', (e) => {
    const el = e.target;
    lastTap = { el, at: Date.now() };
    // Tapping a field the app focused earlier: give the keyboard back and let the tap focus it again.
    if (isField(el) && el.hasAttribute(MARK)) {
      el.removeAttribute(MARK);
      el.removeAttribute('inputmode');
      if (document.activeElement === el) el.blur();
    }
  }, true);

  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (!isField(el) || el.hasAttribute('inputmode') || el.readOnly) return; // our own on-screen keyboard sets inputmode itself
    const tapped = lastTap.el === el && Date.now() - lastTap.at < 800;
    if (tapped) return;
    el.setAttribute('inputmode', 'none');
    el.setAttribute(MARK, '');
  }, true);

  document.addEventListener('focusout', (e) => {
    const el = e.target;
    if (isField(el) && el.hasAttribute(MARK)) {
      el.removeAttribute(MARK);
      el.removeAttribute('inputmode');
    }
  }, true);
}
