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
- `referralCode`
- `referrerId`
- `createdAt`

## LedgerEntry

- `id`
- `userId`
- `currency` — `'coins' | 'energy'`
- `amount` — со знаком (+/-)
- `type` — `'tap' | 'fruit' | 'daily' | 'stake' | 'unstake' | 'referral' | 'upgrade'`
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
- `amount`
- `tier` — `'flex' | 'lock7' | 'lock30'`
- `aprDaily`
- `startedAt`
- `lastAccrualAt`
- `unlockAt`
- `status` — `'active' | 'closed'`

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
