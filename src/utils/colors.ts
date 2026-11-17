/** Category colours: the same on the cashier tiles, the Categories page and the Products list. */
export const CATEGORY_COLORS = ['#8b5a33', '#2f7d6b', '#c8893f', '#7a4f9a', '#2c6e9b', '#b2493b', '#5f7d2f', '#9a6a00', '#4f6b7a', '#a14d7a'];
export const NO_CATEGORY_COLOR = '#9a8b7f';

/** Colour of a category by its place in the category list (GET /categories, sorted by name). */
export function categoryColor(list: { id: string }[], id?: string | null): string {
  const i = id ? list.findIndex((c) => c.id === id) : -1;
  return i < 0 ? NO_CATEGORY_COLOR : CATEGORY_COLORS[i % CATEGORY_COLORS.length];
}

/** Colour for any name (stores, option groups...): always the same for the same name. */
export function nameColor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return CATEGORY_COLORS[h % CATEGORY_COLORS.length];
}

/** "Beverages" -> "B", "Cold Drinks" -> "CD" */
export const initials = (name: string) =>
  name.split(/\s+/).filter((w) => /^[\p{L}\p{N}]/u.test(w)).slice(0, 2).map((w) => [...w][0]).join('').toUpperCase() || '•';
