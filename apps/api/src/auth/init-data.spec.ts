import { describe, expect, it } from 'vitest';

import { parseReferralCode, resolveStartParam } from './init-data.js';

describe('parseReferralCode', () => {
  it('extracts the bare code from a ref_ payload', () => {
    expect(parseReferralCode('ref_4K1OYCt9')).toBe('4K1OYCt9');
  });

  it('rejects non-referral / malformed payloads', () => {
    expect(parseReferralCode(null)).toBeNull();
    expect(parseReferralCode('')).toBeNull();
    expect(parseReferralCode('4K1OYCt9')).toBeNull();
    expect(parseReferralCode('ref_with-dash')).toBeNull();
  });
});

describe('resolveStartParam', () => {
  it('prefers the trusted signed start_param', () => {
    expect(resolveStartParam('ref_signed', 'ref_client')).toBe('ref_signed');
  });

  it('falls back to the client launch param when signed is absent', () => {
    // Root cause: Telegram only guarantees the startapp value in the unsigned
    // tgWebAppStartParam; on clients that omit it from signed initData the
    // referral was lost. The client-supplied launch param recovers it.
    expect(resolveStartParam(null, 'ref_4K1OYCt9')).toBe('ref_4K1OYCt9');
  });

  it('returns null when neither source carries a value', () => {
    expect(resolveStartParam(null, undefined)).toBeNull();
    expect(resolveStartParam(null, '')).toBeNull();
  });
});
