# Дизайн: «Магазин» (бывш. Rewards)

Дата: 2026-06-15 · Ветка: `feat/shop`

## Цель

Переименовать экран `Rewards` → «Магазин», сделать 3 вкладки (Бонус / Бусты /
Товары) и добавить вкладку «Товары» с двумя группами товаров:

- **Лемустеры** — косметические скины лемура (чистая косметика, экипируется
  один, на экономику не влияют).
- **Корзины** — тиры, повышающие доход за счёт **увеличения длительности раунда
  «Купоны»**. Куплено → владеешь навсегда; активна лучшая (старший купленный
  тир).

Каждый товар имеет **две цены**: в монетах и в Telegram Stars. Игрок сам
выбирает способ оплаты (Stars — быстрый шорткат за реальные деньги).

## Декомпозиция и порядок

| Фаза | Содержание |
|---|---|
| **1. UI-оболочка** | rename Rewards→Shop (nav + i18n + роуты/редиректы), 3-я вкладка в `SegmentedToggle`, экран «Товары» с секциями Лемустеры/Корзины и карточками товаров |
| **2. Корзины** | economy + config-каталог + Prisma (`User.basketTier`) + покупка за монеты + применение к раунду купонов |
| **3. Лемустеры** | владение (`UserCosmetic` + `User.equippedSkinId`) + экипировка + рендер в игре/профиле + покупка за монеты |
| **4. Telegram Stars** (отдельный заход) | инвойсы через бота, `pre_checkout`, `successful_payment`, идемпотентная таблица `StarPurchase`, включение второй цены |

**В этот заход — фазы 1–3 (всё за монеты).** Каждый товар в каталоге уже несёт
обе цены (`priceCoins`, `priceStars`), но кнопка оплаты Stars в UI показана
**выключенной** («Скоро»). Stars-механика (фаза 4) — следующим заходом.

## Архитектура изменений

### `packages/shared` (фундамент, контракт для всех)

- **`enums.ts`** — в `LedgerType`/`LEDGER_TYPES` добавить `basket_purchase`,
  `skin_purchase` (оба `−coins`).
- **`config.ts`** — в `GameConfigSchema` + `DEFAULT_GAME_CONFIG` (bump `version`
  до 8):
  - `BasketTierConfigSchema = { tier:int, durationBonusMs:int, priceCoins:int, priceStars:int }`,
    поле `baskets: BasketTierConfig[]` (стартовый каталог 3 тира, напр.
    `+5000 / +10000 / +15000` мс к раунду; цены геометрически растут).
  - `SkinConfigSchema = { id:string, name:string, priceCoins:int, priceStars:int }`,
    поле `skins: SkinConfig[]` (стартово 3–4 скина; цены в монетах/Stars).
- **`economy.ts`** — `effectiveCouponDurationMs(cfg, basketTier): number` =
  `couponSessionDurationMs + (baskets[tier-1]?.durationBonusMs ?? 0)`
  (tier 0 = базовая корзина, бонус 0). `couponMaxScore` принимает эффективную
  длительность (добавить параметр `durationMs`, дефолт = `couponSessionDurationMs`
  для обратной совместимости), чтобы клиент и сервер считали одинаково.
- **`dto/`** — `basketTier` в `UserProfileSchema`; `durationMs` (эффективная) в
  `CouponStartResponseSchema`; новые `ShopCatalog*`, `BuyBasketRequest`,
  `BuySkinRequest`, `EquipSkinRequest`, `ShopPurchaseResponse`.
- **`contract/index.ts`** — ветка `shop`: `catalog` (owned/equipped + каталог с
  ценами), `buyBasket({tier, currency})`, `buySkin({skinId, currency})`,
  `equipSkin({skinId})`. typed errors: `INSUFFICIENT_COINS`, `ALREADY_OWNED`,
  `UNKNOWN_ITEM`, `NOT_OWNED`, `STARS_NOT_AVAILABLE` (фаза 4 заглушка).

### `apps/api`

- **Prisma**: `User.basketTier Int @default(0)`, `User.equippedSkinId String?`;
  новая модель `UserCosmetic { id, userId, skinId, acquiredAt, @@unique([userId, skinId]) }`.
- **`shop/`** (новый модуль `shop.module.ts` / `shop.service.ts` /
  `shop.router.ts`) — каталог из live `GameConfig` + состояние владения; покупки
  за монеты (атомарно: списание + ledger `basket_purchase`/`skin_purchase` +
  обновление `basketTier`/`UserCosmetic`); `currency:'stars'` → ошибка
  `STARS_NOT_AVAILABLE` (фаза 4). Зарегистрировать в `app.module` и в агрегации
  oRPC-router.
- **`coupon.service.ts`** — использовать `effectiveCouponDurationMs(cfg, user.basketTier)`
  везде, где сейчас `cfg.couponSessionDurationMs`: expiry старта, `earliestFinishMs`,
  clamp `elapsedSec`, и передать в `couponMaxScore`. В `CouponStartResponse`
  вернуть `durationMs`.
- **`users.service.ts`** — отдавать `basketTier` в профиле.

### `apps/webapp`

- Каталог `screens/Rewards/` → `screens/Shop/`; компонент `Rewards`→`Shop`.
  Роуты `/rewards`, `/daily`, `/upgrades` редиректят на `/shop`; добавить `/shop`.
- **`SegmentedToggle`** — обобщить с 2 сегментов на N (массив + `--seg-count`,
  ширина thumb = `100/n%`); Profile (2 сегмента) остаётся рабочим.
- **`nav.rewards` → `nav.shop`** (i18n ru/en), иконка прежняя.
- **Вкладка «Товары»** — две секции (Лемустеры / Корзины), карточки: превью,
  название, эффект (для корзин), две цены (Stars-кнопка выключена «Скоро»),
  состояние (куплено / экипировано / активно).
- **shop api-client + zustand-слайс**; `CouponGame` берёт `durationMs` из ответа
  `start` и рендерит экипированный скин (вариант с graceful fallback); профиль
  показывает экипированный скин.

### Спека

`spec/app/13-money-flows.md` (стоки `basket_purchase`/`skin_purchase`, эффект
корзин на раунд), `03-data-model.md` (`UserCosmetic`, `basketTier`,
`equippedSkinId`), `10-api.md` (shop), `spec/orpc/05-procedures.md` +
`02-contract.md`, `CLAUDE.md` (модуль Shop в списке).

## Инварианты (соблюсти)

- Числа экономики — в `GameConfig` (БД), не в коде; webapp берёт каталог в
  рантайме (`shop.catalog`), не импортирует значения.
- Экономика корзин — один источник в `shared/economy.ts`
  (`effectiveCouponDurationMs`), идентично на клиенте и сервере. Сервер
  авторитарен по длительности (clamp по реальному elapsed).
- Деньги — целые монеты, BigInt в БД → number в ответах. Покупки атомарны через
  ledger + уникальные ограничения (идемпотентность владения).
- Никакого cron — всё ленивое; корзина влияет только в момент раунда.
- oRPC — единственный транспорт; сигнатуры процедур меняются один раз в `shared`.

## Вне области (фаза 4 / позже)

- Реальная интеграция Telegram Stars (инвойсы/вебхуки/`StarPurchase`).
- Финальный арт скинов (стартово — плейсхолдеры-варианты с fallback).
- Микро-бонусы у скинов — решено: скины чисто косметические.
