-- Lemur Tap initial schema. Source of truth: spec/app/03-data-model.md.

-- CreateTable users
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "telegramId" TEXT NOT NULL,
    "username" TEXT,
    "isPremium" BOOLEAN NOT NULL DEFAULT false,
    "coins" BIGINT NOT NULL DEFAULT 0,
    "energy" INTEGER NOT NULL DEFAULT 0,
    "energyUpdatedAt" BIGINT NOT NULL DEFAULT 0,
    "referralCode" TEXT NOT NULL,
    "referrerId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_telegramId_key" ON "users"("telegramId");
CREATE UNIQUE INDEX "users_referralCode_key" ON "users"("referralCode");

-- CreateTable user_upgrades
CREATE TABLE "user_upgrades" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "user_upgrades_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_upgrades_userId_type_key" ON "user_upgrades"("userId", "type");

-- CreateTable ledger_entries
CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "type" TEXT NOT NULL,
    "refSource" TEXT,
    "refId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ledger_entries_userId_createdAt_idx" ON "ledger_entries"("userId", "createdAt");

-- CreateTable daily_bonus_claims
CREATE TABLE "daily_bonus_claims" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "claimDate" DATE NOT NULL,
    "streak" INTEGER NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "daily_bonus_claims_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "daily_bonus_claims_userId_claimDate_key" ON "daily_bonus_claims"("userId", "claimDate");

-- CreateTable fruit_game_sessions
CREATE TABLE "fruit_game_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "seed" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "score" INTEGER NOT NULL DEFAULT 0,
    "rewardCoins" BIGINT NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    CONSTRAINT "fruit_game_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "fruit_game_sessions_userId_status_idx" ON "fruit_game_sessions"("userId", "status");
-- Partial unique: at most one active session per user.
CREATE UNIQUE INDEX "fruit_game_sessions_userId_active_key" ON "fruit_game_sessions"("userId") WHERE "status" = 'active';

-- CreateTable stakes
CREATE TABLE "stakes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "tier" TEXT NOT NULL,
    "dailyRate" DECIMAL(10,8) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAccrualAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unlockAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    CONSTRAINT "stakes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "stakes_userId_status_idx" ON "stakes"("userId", "status");

-- CreateTable referrals
CREATE TABLE "referrals" (
    "id" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "refereeId" TEXT NOT NULL,
    "joinBonusGranted" BOOLEAN NOT NULL DEFAULT false,
    "premiumBonusGranted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id"),
    -- Anti self-invite.
    CONSTRAINT "referrals_no_self_invite" CHECK ("referrerId" <> "refereeId")
);

CREATE UNIQUE INDEX "referrals_refereeId_key" ON "referrals"("refereeId");
CREATE INDEX "referrals_referrerId_createdAt_idx" ON "referrals"("referrerId", "createdAt");

-- CreateTable game_configs
CREATE TABLE "game_configs" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "game_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "game_configs_version_key" ON "game_configs"("version");

-- Foreign keys
ALTER TABLE "user_upgrades" ADD CONSTRAINT "user_upgrades_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "daily_bonus_claims" ADD CONSTRAINT "daily_bonus_claims_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fruit_game_sessions" ADD CONSTRAINT "fruit_game_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stakes" ADD CONSTRAINT "stakes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_refereeId_fkey" FOREIGN KEY ("refereeId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
