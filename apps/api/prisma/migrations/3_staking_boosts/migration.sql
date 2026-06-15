-- Staking boosts (spec/app/08 §5, change 2026-06). Per-position, leveled perks
-- bought for coins and bound to a single active position. Three new integer
-- level columns on "stakes", default 0 for all existing rows. The purchase
-- ledger type ('stake_boost') needs no DDL (ledger_entries.type is TEXT).

ALTER TABLE "stakes" ADD COLUMN "boostRateLevel"     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "stakes" ADD COLUMN "boostCapacityLevel" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "stakes" ADD COLUMN "boostUnfreezeLevel" INTEGER NOT NULL DEFAULT 0;
