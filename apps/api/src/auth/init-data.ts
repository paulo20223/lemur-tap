import { createHmac } from 'node:crypto';

/**
 * Telegram user as embedded in WebApp initData (`user` field, URL-decoded JSON).
 * Only the fields we consume are typed; Telegram may send more.
 */
export interface TelegramInitUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

/** Parsed + verified Telegram WebApp initData. */
export interface VerifiedInitData {
  /** Telegram user id as a string (matches User.telegramId). */
  telegramId: string;
  user: TelegramInitUser;
  /** True when the Telegram account has Premium (drives the premium bonus). */
  isPremium: boolean;
  /** Raw `start_param` (deep-link payload), or null. */
  startParam: string | null;
  /** Unix seconds the initData was signed at. */
  authDate: number;
}

export class InitDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InitDataError';
  }
}

/**
 * Validates Telegram WebApp `initData` and returns its parsed payload.
 *
 * Algorithm (Telegram Mini Apps):
 *   secretKey = HMAC_SHA256(key="WebAppData", message=botToken)
 *   expected  = HMAC_SHA256(key=secretKey, message=dataCheckString)
 *   dataCheckString = sorted "k=v\n" of all fields except `hash`.
 *
 * Throws {@link InitDataError} on malformed input, bad signature, or stale
 * `auth_date` (older than `maxAgeMs`).
 */
export function verifyInitData(
  initData: string,
  botToken: string,
  maxAgeMs: number,
  now: number = Date.now(),
): VerifiedInitData {
  if (!initData) {
    throw new InitDataError('Empty initData');
  }

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) {
    throw new InitDataError('Missing hash');
  }

  // Build the data-check-string: every field except `hash`, sorted by key.
  const pairs: string[] = [];
  for (const [key, value] of params.entries()) {
    if (key === 'hash') {
      continue;
    }
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  const secretKey = createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();
  const computed = createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  if (!timingSafeEqualHex(computed, hash)) {
    throw new InitDataError('Bad signature');
  }

  // Freshness window (anti-replay).
  const authDateRaw = params.get('auth_date');
  const authDate = authDateRaw ? Number(authDateRaw) : NaN;
  if (!Number.isFinite(authDate) || authDate <= 0) {
    throw new InitDataError('Missing or invalid auth_date');
  }
  const ageMs = now - authDate * 1000;
  if (ageMs > maxAgeMs) {
    throw new InitDataError('Stale auth_date');
  }
  // Small tolerance for clock skew on the future side.
  if (ageMs < -5 * 60 * 1000) {
    throw new InitDataError('auth_date in the future');
  }

  const userRaw = params.get('user');
  if (!userRaw) {
    throw new InitDataError('Missing user');
  }
  let user: TelegramInitUser;
  try {
    user = JSON.parse(userRaw) as TelegramInitUser;
  } catch {
    throw new InitDataError('Malformed user payload');
  }
  if (typeof user.id !== 'number' || !Number.isFinite(user.id)) {
    throw new InitDataError('Missing user id');
  }

  return {
    telegramId: String(user.id),
    user,
    isPremium: user.is_premium === true,
    startParam: params.get('start_param'),
    authDate,
  };
}

/** Constant-time-ish comparison of two equal-length hex digests. */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Parses `start_param=ref_<code>` into the bare referral code.
 * Returns null when absent or not a referral payload.
 */
export function parseReferralCode(startParam: string | null): string | null {
  if (!startParam) {
    return null;
  }
  const prefix = 'ref_';
  if (!startParam.startsWith(prefix)) {
    return null;
  }
  const code = startParam.slice(prefix.length);
  // base62, fixed length on generation; accept a sane bounded length here.
  if (!/^[0-9A-Za-z]{1,32}$/.test(code)) {
    return null;
  }
  return code;
}

/**
 * Resolves the effective referral start-param for a launch.
 *
 * Telegram only guarantees the `startapp` deep-link value inside the *unsigned*
 * `tgWebAppStartParam` launch parameter; whether it is also embedded in the
 * signed initData `start_param` varies by client/platform. So we prefer the
 * trusted signed value and fall back to the client-supplied launch param.
 *
 * The fallback is low-trust (a crafted client could spoof it), but it only
 * attributes the *referrer* — the referee is always the signed initData user,
 * and abuse is bounded by the referral activity gate, self-invite block and
 * per-referrer caps (see spec/app/11). This mirrors the (also unsigned) ref
 * payload the bot forwards via `tgWebAppStartParam` for web_app buttons.
 */
export function resolveStartParam(
  signed: string | null,
  client: string | null | undefined,
): string | null {
  if (signed) {
    return signed;
  }
  return client && client.length > 0 ? client : null;
}
