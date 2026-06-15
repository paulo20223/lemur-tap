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
- `basketTier` — старший купленный тир корзины (`Int @default(0)`; 0 = базовая корзина без бонуса). Активная корзина = старший купленный тир; читает `GameConfig.baskets[basketTier-1]`, увеличивает эффективную длительность раунда «Купоны» (см. [06](./06-coupon-game.md) и [13](./13-money-flows.md))
- `equippedSkinId` — id экипированного косметического скина (`String?`; `null` = дефолтный `classic`). Можно экипировать только скин, которым владеешь (`UserCosmetic`)
- `referralCode`
- `referrerId`
- `createdAt`

## LedgerEntry

- `id`
- `userId`
- `currency` — `'coins' | 'energy'`
- `amount` — со знаком (+/-)
- `type` — `'tap' | 'fruit' | 'daily' | 'stake' | 'unstake' | 'stake_yield' | 'stake_boost' | 'coupon_boost' | 'referral' | 'upgrade' | 'basket_purchase' | 'skin_purchase'`
  - `stake`/`unstake` — движение принципала (досрочный штраф — отрицательной записью на `unstake`); `stake_yield` — минт дохода при клейме
  - `coupon_boost` — списание монет за покупку купон-буста ([06](./06-coupon-game.md#буст-расходник))
  - `basket_purchase` / `skin_purchase` — списание монет за покупку тира корзины / косметического скина в магазине ([13](./13-money-flows.md))
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

## UserCosmetic

Владение косметическим скином (Лемустер). Покупка пишет строку; владение постоянно.

- `id`
- `userId`
- `skinId` — id скина из `GameConfig.skins`
- `acquiredAt`

Уникальность по паре `userId` + `skinId` (`@@unique`) — повторная покупка невозможна (идемпотентность владения). `onDelete: Cascade` от `User`. Таблица `user_cosmetics`.

## Связи

`User` 1—N `LedgerEntry`, `Stake`, `FruitGameSession`, `DailyBonusClaim`, `UserCosmetic`. `Referral` связывает двух `User` (`referrerId` → `refereeId`). Экипированный скин — `User.equippedSkinId` (должен присутствовать среди `UserCosmetic` пользователя).

Параметры начислений и расход энергии описаны в [04 — Экономика](./04-economy.md).

---

[← Оглавление](./README.md)
