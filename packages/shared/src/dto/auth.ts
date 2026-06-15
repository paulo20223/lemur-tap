/** Auth DTOs. POST /auth/telegram (spec/app/10). */

import * as z from 'zod';

import type { GameConfig } from '../config.js';
import { UserProfileSchema } from './common.js';

export const AuthTelegramRequestSchema = z.object({
  /** Raw Telegram WebApp initData query string. */
  initData: z.string(),
  /**
   * `tgWebAppStartParam` launch parameter (the `startapp` deep-link payload),
   * forwarded explicitly because Telegram does not reliably embed it in the
   * signed initData on every client/platform. Low-trust referrer attribution
   * hint only; the server prefers the signed `start_param` when present.
   */
  startParam: z.string().optional(),
});

export const AuthTelegramResponseSchema = z.object({
  /** Short-lived session JWT (Bearer). */
  jwt: z.string(),
  profile: UserProfileSchema,
});

export type AuthTelegramRequest = z.infer<typeof AuthTelegramRequestSchema>;
export type AuthTelegramResponse = z.infer<typeof AuthTelegramResponseSchema>;

/** GET /config — live economy config for the client. */
export type ConfigResponse = GameConfig;
