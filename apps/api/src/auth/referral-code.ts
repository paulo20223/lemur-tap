import { randomInt } from 'node:crypto';

const BASE62 =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** Fixed referral-code length (base62, case-sensitive). See spec/app/09. */
export const REFERRAL_CODE_LENGTH = 8;

/** Generates a random fixed-length base62 referral code. */
export function generateReferralCode(length = REFERRAL_CODE_LENGTH): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += BASE62[randomInt(BASE62.length)];
  }
  return out;
}
