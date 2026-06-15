# Траты и заработок (money flows)

Сухая сводка всех источников и стоков монет: формулы + дефолтные числа. Каждое движение монет — строка леджера (`LedgerType`).

**Источник чисел:** `DEFAULT_GAME_CONFIG` v8 (`packages/shared/src/config.ts`) — то, что сидится в БД и правится без редеплоя. **Источник формул:** `packages/shared/src/economy.ts`. Здесь — снимок дефолтов; истина в рантайме — live `GameConfig`.

Деньги — целые монеты, любое начисление/процент `floor`-ится (проценты рефералки/стейкинга, награды). Геометрические цены — `round`.

## Обозначения

- `L` — уровень (ветки апгрейда / буста). Хард-кап всех веток: `maxLevel = 20`.
- `price(L→L+1) = round(base · mult^L)`; первая покупка (0→1) стоит `base`.
- `cum(L) = Σ_{i=0}^{L-1} round(base · mult^i)` — суммарная стоимость владеть уровнем `L`.

## Леджер: знак каждого типа

| LedgerType | Знак | Механика |
|---|---|---|
| `coupon` | + | награда за раунд мини-игры |
| `daily` | + | ежедневный бонус |
| `stake_yield` | + | клейм пассивного дохода стейкинга |
| `unstake` | + | возврат тела позиции (за вычетом штрафа при раннем выходе) |
| `referral` | + | бонусы рефералки (`join` / `premium` / `passive`) |
| `upgrade` | − | покупка уровня апгрейда |
| `coupon_boost` | − | расходник: долив энергии на попытку |
| `stake` | − | завод тела в позицию (заморозка, не сжигание) |
| `stake_boost` | − | покупка уровня буста позиции |
| `basket_purchase` | − | покупка тира корзины (магазин → бусты дохода) |
| `skin_purchase` | − | покупка косметического скина лемура (магазин) |

> Ранний выход из `lock` не отдельный тип: тело возвращается строкой `unstake` уже за вычетом штрафа, недоклеймленное хранилище сгорает.

---

## Заработок (+)

### `coupon` — мини-игра «Купоны»
```
reward = min(couponMaxCoins, floor(score · couponCoinPerPoint · couponMult))
score  ≤ couponMaxScore = floor(min(elapsed, 30s) · couponMaxPointsPerSec)
```
- `couponCoinPerPoint = 1`, `couponMaxCoins = 3000`, `couponMaxPointsPerSec = 100` ⇒ потолок скора 3000/раунд, потолок монет 3000.
- `couponMult = 1 + 0.1·L` (ветка `couponMult`).
- Раунд: длительность 30 с, grace на финиш 5 с. Rate-limit: ≤ 5 запросов / 10 с.
- Вход в раунд стоит 500 энергии (см. трату «энергия» ниже) ⇒ дневной гейт ≈ число восстановленных баров.

### `daily` — ежедневный бонус
```
reward = dailyRewards[min(streak, 7) − 1]   // 1-based по дню стрика
dailyRewards = [10, 15, 20, 30, 40, 60, 100]   // дни 1..7+, день 7+ = 100
```

### `stake_yield` — пассивный доход стейкинга (клейм)
```
stored += floor(amount · rateEff · Δms / 86_400_000),  затем  stored = min(stored, capEff)
rateEff = rateDaily · (1 + 0.2·L_rate)            // буст rate, max L=5
capEff  = floor(vaultCap · (1 + 0.5·L_capacity))  // буст capacity, max L=5
vaultCap = baseVaultCapacity + 1500·L_vault = 3000 + 1500·L_vault   // ветка Vault
```
- Линейно (не сложный процент), тело выплачивается отдельно. Хранилище — мягкий кап: полное просто паузит начисление (overflow теряется → стимул вернуться и клеймить).
- Тарифы: `flex` 1%/день, `lock` 3%/день (см. ниже).

### `unstake` — возврат тела
```
normal (flex, или lock после анлока):  return = amount
ранний выход lock:                     return = floor(amount · (1 − penaltyEff))
penaltyEff = basePenalty · (1 − 0.5·L_unfreeze)   // буст unfreeze, max L=2 ⇒ L2 обнуляет штраф
```
Недоклеймленное хранилище при раннем выходе сгорает.

### `referral` — рефералка
| Источник (`RefSource`) | Рефереру | Приглашённому | Тип |
|---|---|---|---|
| `join` | +5000 | +2000 | разовый |
| `premium` (у приглашённого Telegram Premium) | +25000 | +2000 | разовый |
| `passive` | `floor(0.1 · couponIncome)` приглашённого | — | стриминг |

- Гейт активности: бонусы начисляются только когда у приглашённого ≥ 1 завершённой coupon-сессии.
- Пассив: `referralPassiveRate = 0.1` от купонного дохода приглашённого, минтится рефереру; хард-кап суммарного пассива на реферера `referralPassiveCap = 1_000_000`.
- Капы наград: ≤ 50 оплаченных рефералов/сутки (UTC), ≤ 500 суммарно.

---

## Траты (−)

### `upgrade` — ветки апгрейдов
`price(L→L+1) = round(base · mult^L)`, эффект — линейный прирост `+perLevel·L`.

| Ветка | base | mult | Эффект/ур. | Эффективная величина |
|---|---|---|---|---|
| `maxEnergy` | 2000 | 1.8 | +500 энергии | `max_energy = 500 + 500·L` |
| `energyRegen` | 5000 | 2.0 | +0.5 эн/с | `regen = 500/3600 + 0.5·L` эн/с |
| `couponMult` | 3000 | 1.7 | +0.1 множ. | `coupon_mult = 1 + 0.1·L` |
| `vault` | 8000 | 1.8 | +1500 ёмк. | `vault_cap = 3000 + 1500·L` монет/день |

### `coupon_boost` — расходник энергии
```
price  = couponBoostPrice = 50
grant  = couponBoostEnergyGrant = 500 энергии (= стоимость одного раунда), зажат по max_energy
лимит  = couponBoostDailyCap = 50 покупок / UTC-сутки (счёт строк леджера coupon_boost)
```
Цена ≈ половина типичной выплаты за раунд (~70–100), а не антифрод-кап 3000. Сверх лимита — ошибка `coupon_boost_limit` (429).

### `stake` — завод тела в позицию (заморозка)
По одной активной позиции на тариф; обе доливаемы. Тело не тратится, а блокируется (возвращается на `unstake`).

| Тариф | rateDaily | minStake | termDays | earlyPenalty |
|---|---|---|---|---|
| `flex` | 1%/день | 5000 | 0 (без лока) | 0 |
| `lock` | 3%/день | 10000 | 14 | 10% |

### `stake_boost` — бусты позиции (per-position)
`price(L→L+1) = round(base · mult^L)`. Привязаны к активной позиции, сгорают при unstake.

| Буст | base | mult | Эффект/ур. | maxLevel |
|---|---|---|---|---|
| `rate` ⚡ | 5000 | 1.8 | ×(1 + 0.2·L) к ставке | 5 |
| `capacity` 🗄 | 4000 | 1.8 | ×(1 + 0.5·L) к ёмкости | 5 |
| `unfreeze` 🔓 | 6000 | 2.2 | −0.5·L к штрафу (L2 → 0) | 2 |

### `basket_purchase` — корзины (магазин)

Тиры корзин повышают **доход** за счёт увеличения эффективной длительности раунда «Купоны». Куплено → владеешь навсегда; активен старший купленный тир (`User.basketTier`). Каталог — в live `GameConfig` (`baskets: BasketTierConfig[]`), webapp берёт его процедурой `shop.catalog`, значения не импортирует.

```
price  = baskets[tier-1].priceCoins   // монеты; геометрически растут
effect = baskets[tier-1].durationBonusMs   // +мс к длительности раунда
```
- Дефолтный каталог (`DEFAULT_GAME_CONFIG` v11). 6 ступеней — «лестница носителей предпринимателя» (картон → холст → кожа → бронза → серебро → золото). **tier 0 «Картонная» — бесплатный дефолт у всех** (бонус 0, цена 0, всегда owned, аналог бесплатного дефолт-скина), входит в каталог как активная база. Платные tier 1–5 удлиняют раунд (до +12с → 42с на топе), цена ×~2.2 за тир:

| tier | материал | durationBonusMs | priceCoins | priceStars |
|---|---|---|---|---|
| 0 | Картонная | +0 | 0 (бесплатно) | 0 |
| 1 | Холщовая | +4000 | 120000 | 70 |
| 2 | Кожаная | +6000 | 280000 | 140 |
| 3 | Бронзовая | +8000 | 640000 | 280 |
| 4 | Серебряная | +10000 | 1400000 | 480 |
| 5 | Золотая | +12000 | 3000000 | 800 |

- **Влияние на доход:** эффективная длительность раунда — `effectiveCouponDurationMs(cfg, basketTier) = couponSessionDurationMs + (baskets[basketTier-1]?.durationBonusMs ?? 0)` (один источник в `economy.ts`, идентичен на клиенте и сервере). Сервер передаёт её 4-м аргументом в `couponMaxScore(...)`, поэтому антифрод-потолок очков (а с ним и потолок дохода `couponMaxCoins`) растёт пропорционально удлинённому раунду — корзина даёт больше времени ловить купоны, не упираясь в кап.
- Покупка атомарна: списание монет + строка леджера `basket_purchase` + обновление `User.basketTier`. Повторная покупка уже принадлежащего/младшего тира → `ALREADY_OWNED`. Оплата за монеты — `shop.buyBasket` с `currency:'coins'` (на `currency:'stars'` он по-прежнему отдаёт `STARS_NOT_AVAILABLE` — монетный путь только монетный); за Stars — отдельный поток `shop.createStarsInvoice` (см. ниже).

### `skin_purchase` — скины «Лемустеры» (магазин)

Косметические скины лемура — чистая косметика, на экономику **не влияют**. Куплено → владеешь навсегда (`UserCosmetic`); экипируется один (`User.equippedSkinId`). Каталог — в live `GameConfig` (`skins: SkinConfig[]`).

```
price = skins[id].priceCoins   // монеты
```
- Дефолтный каталог (`DEFAULT_GAME_CONFIG` v8):

| id | name | priceCoins | priceStars |
|---|---|---|---|
| `classic` | Классический | 0 | 0 |
| `golden` | Золотой | 10000 | 100 |
| `ninja` | Ниндзя | 30000 | 250 |
| `astro` | Космонавт | 75000 | 500 |

- `classic` — бесплатный дефолт (цена 0, выдаётся по умолчанию). Покупка атомарна: списание монет + строка леджера `skin_purchase` + запись `UserCosmetic`. Повторная покупка → `ALREADY_OWNED`. Экипировка (`shop.equipSkin`) монет не стоит и в леджер не пишет; экипировать можно только владеемый скин (иначе `NOT_OWNED`). Оплата за монеты — `shop.buySkin` с `currency:'coins'` (на `currency:'stars'` он отдаёт `STARS_NOT_AVAILABLE`); за Stars — `shop.createStarsInvoice` (см. ниже).

### Оплата за Telegram Stars (фаза 4 — активна)

Альтернативный путь оплаты тех же товаров (корзины и скины) за Telegram Stars (валюта `XTR`). Монеты при этом **не** двигаются.

```
webapp → shop.createStarsInvoice({ kind:'basket'|'skin', ref })   // ref: тир строкой ("1") или skinId
  ├─ валидация как у монетного пути (UNKNOWN_ITEM / ALREADY_OWNED; корзина — только следующий тир)
  ├─ StarsInvoice { userId, kind, ref, priceStars(из live GameConfig), status:'pending' }
  └─ bot.createInvoiceLink(XTR, provider_token='') → { invoiceLink }   // бот выключен → STARS_NOT_AVAILABLE
webapp → openInvoice(invoiceLink)
Telegram → bot pre_checkout_query   → проверка StarsInvoice.id(payload)+status:'pending' → answerPreCheckoutQuery(true/false)
Telegram → bot successful_payment   → ShopService.fulfillStarsInvoice(invoiceId, telegramChargeId)
```

- `fulfillStarsInvoice` идемпотентен: ключ — `StarsInvoice.telegramChargeId @unique`. Повторная доставка `successful_payment` (инвойс уже `'paid'` или charge уже записан) → no-op без повторной выдачи. Отсутствующий/не-`'pending'` инвойс → лог + no-op (никогда не бросает в bot-handler).
- Выдача по `kind`: `'basket'` — повторная проверка `tier === user.basketTier + 1` и keyed-`updateMany` тира (уже продвинут → no-op); `'skin'` — `UserCosmetic.create`, `P2002` (уже владеет) терпится как no-op. Затем инвойс помечается `'paid'` (+`telegramChargeId`, `paidAt`).
- **Леджер не пишется** — он аудит монет (`User.coins` сходится с суммой леджера); покупки за Stars монет не двигают, их аудит — сама строка `StarsInvoice`. Новых типов леджера не добавляется.

### Расход энергии (не монеты, но гейтит `coupon`)
```
Вход в раунд: couponSessionCost = 500 энергии = baseMaxEnergy (L0)
Регенерация (ленивая): regen эн/с ⇒ полный бар L0 за 500 / (500/3600) = 3600 с = 1 час
```
Энергия тратится **только** на старт раунда «Купоны». Полный бар = ровно один раунд; кулдаун раунда = время регена бара.

---

## Сводный баланс

**Притоки монет:** `coupon`, `daily`, `stake_yield`, `unstake` (тело назад), `referral`.
**Оттоки монет:** `upgrade`, `coupon_boost`, `stake` (заморозка), `stake_boost`, `basket_purchase`, `skin_purchase`, штраф раннего выхода `lock`.

Главный сток — геометрически дорожающие апгрейды и бусты стейкинга. Стейкинг — нетто-нейтрален по телу (минус `stake`, плюс `unstake`), чистый доход = `stake_yield` под капом ёмкости (ветка `vault` + буст `capacity`). Магазин (`basket_purchase` — реинвест в доход через длительность раунда; `skin_purchase` — чистый косметический сток) — дополнительные направления траты накопленных монет.

См. также: [04 — Экономика](./04-economy.md) · [06 — Купоны](./06-coupon-game.md) · [07 — Дейли](./07-daily-bonus.md) · [08 — Стейкинг](./08-staking.md) · [09 — Рефералы](./09-referral.md) · [12 — Прогрессия](./12-progression.md).

---
[← Оглавление](./README.md)
</content>
</invoke>
