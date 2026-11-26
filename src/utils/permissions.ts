// Copyright (c) 2026 Chea Phearom. All rights reserved.
// Proprietary and confidential: see the LICENSE file.
/**
 * What an Admin may do on top of everything a store manager does (all stores), ticked by a super admin in Users.
 * Same keys as pos-backend src/common/permissions.ts.
 */
export const ADMIN_PERMISSIONS = [
  { key: 'products', label: 'Products & prices', hint: 'new products, photos, size prices, bulk and scheduled prices, import' },
  { key: 'catalogue', label: 'Categories, drink options & recipes', hint: '' },
  { key: 'marketing', label: 'Promotions, coupons & gift vouchers', hint: '' },
  { key: 'wallet', label: 'Create wallet cards', hint: '' },
  { key: 'stores', label: 'Create stores', hint: '' },
  { key: 'users', label: 'Manage store managers and cashiers', hint: 'all stores' },
  { key: 'display', label: 'Customer display slides', hint: '' },
  { key: 'integrations', label: 'Integrations', hint: 'API keys, webhooks, BROWN menu sync' },
  { key: 'monitor', label: 'System monitor & Telegram summary', hint: '' },
] as const;
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number]['key'];
