/**
 * Seeds a GameConfig row from DEFAULT_GAME_CONFIG.
 * Idempotent: upserts by `version`.
 */
import { PrismaClient } from '@prisma/client';
import { DEFAULT_GAME_CONFIG } from '@lemur/shared';

const prisma = new PrismaClient();

async function main() {
  const cfg = DEFAULT_GAME_CONFIG;
  await prisma.gameConfig.upsert({
    where: { version: cfg.version },
    create: {
      version: cfg.version,
      data: cfg as unknown as object,
    },
    update: {
      data: cfg as unknown as object,
    },
  });
  console.log(`Seeded GameConfig v${cfg.version}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
