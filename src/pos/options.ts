// Copyright (c) 2026 Chea Phearom. All rights reserved.
// Proprietary and confidential: see the LICENSE file.
import type { OptionGroup } from '@/components/pos/PosOptions.vue';

/** A product's own option in this store (sizes with their price, which BROWN options a drink offers). */
export interface OwnOption { optionId: string; groupId: string; price: string | number; isDefault: boolean }

/**
 * The option groups to show for one product. A group with own options for the product is limited to those options,
 * at the product's price and with its default (e.g. Americano: S +0.00, M +0.50 pre-selected, L +1.10);
 * other groups show all their options at the normal price. Empty groups are left out.
 */
export function groupsForProduct(all: OptionGroup[], groupIds: string[] | undefined, own: OwnOption[] | undefined): OptionGroup[] {
  const mine = own ?? [];
  return (groupIds ?? [])
    .map((id) => all.find((g) => g.id === id))
    .filter((g): g is OptionGroup => !!g)
    .map((g) => {
      const rows = mine.filter((r) => r.groupId === g.id);
      if (!rows.length) return g;
      const options = g.options
        .filter((o) => rows.some((r) => r.optionId === o.id))
        .map((o) => {
          const r = rows.find((x) => x.optionId === o.id)!;
          return { ...o, priceDelta: String(r.price), isDefault: r.isDefault };
        });
      return { ...g, options };
    })
    .filter((g) => g.options.length > 0);
}
