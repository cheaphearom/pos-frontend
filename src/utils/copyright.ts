// Copyright (c) 2026 Chea Phearom. All rights reserved.
// Proprietary and confidential: see the LICENSE file.
/** The copyright line shown in the app (login page, admin sidebar). The year range grows by itself. */
const FIRST_YEAR = 2026;
const year = new Date().getFullYear();
export const COPYRIGHT = `© ${year > FIRST_YEAR ? `${FIRST_YEAR}–${year}` : FIRST_YEAR} Chea Phearom. All rights reserved.`;
