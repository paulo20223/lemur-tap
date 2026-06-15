import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * A Prisma transaction client (interactive `$transaction((tx) => ...)`) OR the
 * root client — both accepted so EconomyService helpers compose inside larger
 * feature transactions.
 */
export type PrismaTx = Prisma.TransactionClient | PrismaClient;
