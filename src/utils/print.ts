// Copyright (c) 2026 Chea Phearom. All rights reserved.
// Proprietary and confidential: see the LICENSE file.
/**
 * Prints one element (a receipt, a shift report) on its own, for 80 mm thermal printers.
 *
 * The element is copied into a hidden frame with the app's styles and printed from there, so the printer gets
 * only the receipt: no invisible POS screen behind it, no blank page after it, no wasted paper.
 * The paper size comes from the printer (80 mm roll); only the margins are set here.
 */
export function printElement(el: Element | null | undefined, widthMm = 72): void {
  if (!el) return;
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  const styles = [...document.querySelectorAll('style, link[rel="stylesheet"]')].map((n) => n.outerHTML).join('\n');
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>Receipt</title>${styles}
<style>
  @page { margin: 2mm; }
  html, body { margin: 0; padding: 0; background: #fff !important; height: auto !important; min-height: 0 !important; overflow: visible !important; }
  body { width: ${widthMm}mm; }
  body, body * { color: #000 !important; box-shadow: none !important; }
  .no-print { display: none !important; }
</style></head><body>${el.outerHTML}</body></html>`);
  doc.close();
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    const w = frame.contentWindow!;
    w.focus();
    w.print();
    // print() waits for the dialog in most browsers; remove the frame a little later either way
    setTimeout(() => frame.remove(), 1500);
  };
  frame.addEventListener('load', () => setTimeout(go, 50));
  setTimeout(go, 800); // in case load already fired
}
