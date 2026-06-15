-- AlterTable
ALTER TABLE "users" ADD COLUMN     "basketTier" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "equippedSkinId" TEXT;

-- CreateTable
CREATE TABLE "user_cosmetics" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "skinId" TEXT NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_cosmetics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_cosmetics_userId_skinId_key" ON "user_cosmetics"("userId", "skinId");

-- AddForeignKey
ALTER TABLE "user_cosmetics" ADD CONSTRAINT "user_cosmetics_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

