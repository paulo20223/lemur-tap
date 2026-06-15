-- Rename fruit table -> coupon table (preserves rows/PK/FK).
ALTER TABLE "fruit_game_sessions" RENAME TO "coupon_game_sessions";

-- Rename dependent indexes/constraints to match the new table name.
ALTER INDEX "fruit_game_sessions_userId_status_idx"
  RENAME TO "coupon_game_sessions_userId_status_idx";
ALTER INDEX "fruit_game_sessions_userId_active_key"
  RENAME TO "coupon_game_sessions_userId_active_key";
ALTER TABLE "coupon_game_sessions"
  RENAME CONSTRAINT "fruit_game_sessions_pkey" TO "coupon_game_sessions_pkey";
ALTER TABLE "coupon_game_sessions"
  RENAME CONSTRAINT "fruit_game_sessions_userId_fkey" TO "coupon_game_sessions_userId_fkey";

-- Backfill UserUpgrade rows: rename branch, drop removed tapPower branch.
UPDATE "user_upgrades" SET "type" = 'couponMult' WHERE "type" = 'fruitMult';
DELETE FROM "user_upgrades" WHERE "type" = 'tapPower';

-- Backfill LedgerEntry types: fruit->coupon.
-- Decision: leave historical 'tap' ledger rows AS-IS for audit integrity. The
-- TS LedgerType union no longer lists 'tap', but the column is free-form String;
-- no endpoint serializes raw ledger entries (referral.list aggregates only), so
-- legacy 'tap' rows are safe and intentionally untouched.
UPDATE "ledger_entries" SET "type" = 'coupon' WHERE "type" = 'fruit';
