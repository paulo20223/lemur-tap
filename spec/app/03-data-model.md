# Модель данных

Балансы пользователя (`coins`, `energy`) хранятся прямо на сущности `User` для быстрого чтения и обновления. `LedgerEntry` ведёт аудит всех движений валют и служит источником правды при разборе спорных случаев — баланс на `User` всегда должен сходиться с суммой записей леджера.

## User

- `id`
- `telegramId`
- `username`
- `isPremium`
- `coins`
- `energy`
- `energyUpdatedAt`
- `maxEnergy`
- `tapPower`
- `fruitMult`
- `energyRegen`
- `vaultLevel` — уровень ветки апгрейда Vault (ёмкость хранилища стейкинга)
- `referralCode`
- `referrerId`
- `createdAt`

## LedgerEntry

- `id`
- `userId`
- `currency` — `'coins' | 'energy'`
- `amount` — со знаком (+/-)
- `type` — `'tap' | 'fruit' | 'daily' | 'stake' | 'unstake' | 'stake_yield' | 'stake_boost' | 'coupon_boost' | 'referral' | 'upgrade'`
  - `stake`/`unstake` — движение принципала (досрочный штраф — отрицательной записью на `unstake`); `stake_yield` — минт дохода при клейме
  - `coupon_boost` — списание монет за покупку купон-буста ([06](./06-coupon-game.md#буст-расходник))
- `refId`
- `createdAt`

## DailyBonusClaim

- `id`
- `userId`
- `day`
- `streak`
- `claimedAt`

Уникальность по паре `userId` + UTC-дата (не более одного клейма в сутки).

## FruitGameSession

- `id`
- `userId`
- `seed`
- `nonce`
- `startedAt`
- `finishedAt`
- `score`
- `rewardCoins`
- `status` — `'active' | 'finished' | 'rejected'`

## Stake

- `id`
- `userId`
- `amount` — принципал (BigInt)
- `tier` — `'flex' | 'lock'`
- `rateDaily` — ставка тарифа (доля/день), снимок из `GameConfig` на момент стейка
- `storageAccrued` — накопленный, но не собранный доход (BigInt), зажат `capacity`
- `startedAt`
- `lastClaimAt` — момент последнего клейма/перезапуска накопления
- `unlockAt` — только для `lock`
- `status` — `'active' | 'closed'`

Доход капает лениво от `lastClaimAt` и упирается в ёмкость хранилища `capacity` (растёт веткой апгрейда Vault, см. [08 — Стейкинг](./08-staking.md)).

## Referral

- `id`
- `referrerId`
- `refereeId`
- `joinBonusGranted`
- `createdAt`

## Связи

`User` 1—N `LedgerEntry`, `Stake`, `FruitGameSession`, `DailyBonusClaim`. `Referral` связывает двух `User` (`referrerId` → `refereeId`).

Параметры начислений и расход энергии описаны в [04 — Экономика](./04-economy.md).

---

[← Оглавление](./README.md)
