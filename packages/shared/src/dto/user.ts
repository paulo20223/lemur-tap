/** User DTOs. GET /me (spec/app/10). */

import type { UserProfileDto } from './common.js';

/** GET /me — profile + balances with recomputed energy. */
export type MeResponse = UserProfileDto;
