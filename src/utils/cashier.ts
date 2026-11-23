// Copyright (c) 2026 Chea Phearom. All rights reserved.
// Proprietary and confidential: see the LICENSE file.
/**
 * Cashiers work on the POS. Besides it only: their own sales (reprint, and refund or void with a manager PIN),
 * the barista screen and bakery production. Every other page sends them back to the POS.
 */
export const CASHIER_PAGES = ['/pos', '/sales', '/kitchen', '/production'];
