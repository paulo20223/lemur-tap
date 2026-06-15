-- CreateTable
CREATE TABLE "stars_invoices" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "priceStars" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "telegramChargeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "stars_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stars_invoices_telegramChargeId_key" ON "stars_invoices"("telegramChargeId");

-- CreateIndex
CREATE INDEX "stars_invoices_userId_idx" ON "stars_invoices"("userId");

-- AddForeignKey
ALTER TABLE "stars_invoices" ADD CONSTRAINT "stars_invoices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
