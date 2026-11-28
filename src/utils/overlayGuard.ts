// Copyright (c) 2026 Chea Phearom. All rights reserved.
// Proprietary and confidential: see the LICENSE file.
/**
 * Safety net for "the screen is frozen, nothing can be tapped until I refresh".
 *
 * A pop-up is drawn on a full-screen backdrop (mask). If a pop-up is closed while it is still opening or closing
 * (a fast double tap, a scanner Enter, a sale finishing at the same moment), the backdrop can stay behind with
 * no window in it: invisible or faintly dark, it covers the screen and swallows every tap. The page also stays
 * locked against scrolling. This check removes such empty backdrops and unlocks the page.
 */
const MASKS = '.p-dialog-mask, .p-drawer-mask';
const PANELS = '.p-dialog, .p-drawer, .p-confirmdialog, .p-confirm-dialog';

/** A backdrop with no pop-up in it, or whose pop-up is already gone from view. */
function isEmpty(mask: Element) {
  const panel = mask.querySelector(PANELS) as HTMLElement | null;
  if (!panel) return true;
  const st = getComputedStyle(panel);
  return st.display === 'none' || st.visibility === 'hidden' || panel.getBoundingClientRect().width === 0;
}

export function installOverlayGuard(intervalMs = 1500) {
  if (typeof window === 'undefined') return;
  const suspects = new WeakSet<Element>();
  setInterval(() => {
    const masks = Array.from(document.querySelectorAll(MASKS));
    for (const m of masks) {
      if (!isEmpty(m)) { suspects.delete(m); continue; }
      // Seen empty twice in a row (about 1.5–3 s): not an opening/closing animation, a leftover.
      if (suspects.has(m)) {
        m.remove();
        console.warn('[pos] removed a leftover pop-up backdrop that was blocking taps');
      } else suspects.add(m);
    }
    if (!document.querySelector(MASKS)) {
      document.body.classList.remove('p-overflow-hidden');
      document.body.style.removeProperty('--p-scrollbar-width');
    }
  }, intervalMs);
}
