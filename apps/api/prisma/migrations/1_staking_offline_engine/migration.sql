-- Staking as an offline yield engine (spec/app/08, change 2026-06).
-- Stake: rateDaily rename + storageAccrued; tiers flex/lock7/lock30 -> flex/lock;
-- one active position per tier (partial unique index). Yield ('stake_yield')
-- and vault upgrade levels need no DDL (ledger.type/user_upgrades.type are TEXT).

-- 1) Rename the snapshot rate column (aprDaily/dailyRate -> rateDaily) and the
--    accrual anchor (lastAccrualAt -> lastClaimAt; same role, now also reset on
--    claim/top-up).
ALTER TABLE "stakes" RENAME COLUMN "dailyRate" TO "rateDaily";
ALTER TABLE "stakes" RENAME COLUMN "lastAccrualAt" TO "lastClaimAt";

-- 2) Add the storage bucket (banked, unclaimed yield), default 0 for all rows.
ALTER TABLE "stakes" ADD COLUMN "storageAccrued" BIGINT NOT NULL DEFAULT 0;

-- 3) Collapse the two old lock tiers into the single 'lock' tier.
UPDATE "stakes" SET "tier" = 'lock' WHERE "tier" IN ('lock7', 'lock30');

-- 4) Enforce one active position per tier before adding the unique index:
--    close older duplicates (keep the newest) so the index cannot fail. The
--    principal stays recoverable via unstake on the surviving/closed rows.
UPDATE "stakes" SET "status" = 'closed', "closedAt" = CURRENT_TIMESTAMP
WHERE "status" = 'active' AND "id" NOT IN (
  SELECT DISTINCT ON ("userId", "tier") "id"
  FROM "stakes"
  WHERE "status" = 'active'
  ORDER BY "userId", "tier", "startedAt" DESC
);

-- 5) One active position per (user, tier).
CREATE UNIQUE INDEX "stakes_userId_tier_active_key"
  ON "stakes"("userId", "tier") WHERE "status" = 'active';
