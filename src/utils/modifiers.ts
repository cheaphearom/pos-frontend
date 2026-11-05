/** "Large · 50% · Oat milk +0.60" from a sale line's saved options. */
export function optionsText(mods: { option: string; price?: string | number }[] | null | undefined, withPrice = false) {
  return (mods ?? []).map((m) => m.option + (withPrice && Number(m.price) ? ` +${Number(m.price).toFixed(2)}` : '')).join(' · ');
}
