# Процедуры (маппинг REST → oRPC)

1:1 перенос текущих эндпоинтов. Колонка «auth» — публичная (`pub`) или требует JWT (`authed`); «limit» — именованный rate-limit middleware.

| Процедура | Прежний REST | Input | Output | auth | limit |
| --- | --- | --- | --- | --- | --- |
| `auth.telegram` | `POST /auth/telegram` | `AuthTelegramRequest { initData }` | `AuthTelegramResponse { jwt, profile }` | pub | `auth` |
| `users.me` | `GET /me` | — | `MeResponse` (UserProfileDto) | authed | — |
| `users.config` | `GET /config` | — | `GameConfig` | authed | — |
| `upgrades.list` | `GET /upgrades` | — | `UpgradeStateDto[]` | authed | — |
| `upgrades.buy` | `POST /upgrades/:type/buy` | `{ type: UpgradeType }` | `UpgradeBuyResponse` | authed | — |
| `coupon.start` | `POST /coupon/start` | — | `CouponStartResponse { sessionId, seed }` | authed | `coupon` |
| `coupon.finish` | `POST /coupon/finish` | `CouponFinishRequest { sessionId, score }` | `CouponFinishResponse { reward, coins }` | authed | `coupon` |
| `coupon.boost` | _новая_ | — | `CouponBoostResponse { coins, energy, energyUpdatedAt }` | authed | `coupon` |
| `daily.status` | `GET /daily` | — | `DailyStatusResponse` | authed | — |
| `daily.claim` | `POST /daily/claim` | — | `DailyClaimResponse` | authed | — |
| `staking.list` | `GET /staking` | — | `StakePositionDto[]` | authed | — |
| `staking.stake` | `POST /staking/stake` | `StakeRequest { amount, tier }` | `StakeResponse` | authed | — |
| `staking.unstake` | `POST /staking/unstake` | `UnstakeRequest { stakeId }` | `UnstakeResponse` | authed | — |
| `referral.list` | `GET /referral` | `ReferralQuery { limit?, cursor? }` | `ReferralResponse` | authed | — |
| `shop.catalog` | _новая_ | — | `ShopCatalogResponse` | authed | — |
| `shop.buyBasket` | _новая_ | `BuyBasketRequest { tier, currency }` | `ShopPurchaseResponse` | authed | — |
| `shop.buySkin` | _новая_ | `BuySkinRequest { skinId, currency }` | `ShopPurchaseResponse` | authed | — |
| `shop.equipSkin` | _новая_ | `EquipSkinRequest { skinId }` | `ShopPurchaseResponse` | authed | — |
| `shop.createStarsInvoice` | _новая_ | `StarsInvoiceRequest { kind, ref }` | `StarsInvoiceResponse { invoiceLink }` | authed | — |

Заметки:
- `upgrades.buy`: `type` раньше был path-параметром, теперь поле input.
- `referral.list`: `limit`/`cursor` раньше query-параметры, теперь поля input (ограничение `limit` 1–50 — в zod-схеме).
- `shop.*` — магазин. Каталог собирается из live `GameConfig` (`baskets`/`skins`) + владение; покупки за монеты идут через `shop.buyBasket`/`shop.buySkin` с `currency:'coins'` (на `currency:'stars'` они по-прежнему отдают typed error `STARS_NOT_AVAILABLE` — монетный путь только монетный). Отдельный rate-limit не вешается — конечная гарантия идемпотентности владения — уникальные ограничения БД (`UserCosmetic @@unique`, монотонный `User.basketTier`).
- `shop.createStarsInvoice` (фаза 4, Telegram Stars — **активна**) — валидирует ровно как монетный путь (`kind:'basket'` → `ref` = следующий тир строкой; `kind:'skin'` → `ref` = `skinId`; переиспользует `UNKNOWN_ITEM`/`ALREADY_OWNED`), создаёт строку `StarsInvoice (status:'pending')` и просит бота `createInvoiceLink` (валюта `XTR`, пустой provider_token). Если бот выключен/не настроен → `STARS_NOT_AVAILABLE`. Webapp открывает ссылку через `openInvoice`. Выдача — асинхронная, бот-driven (вне oRPC): `pre_checkout_query` гейтит по `StarsInvoice.id` (payload) + `status:'pending'`; `message:successful_payment` → `ShopService.fulfillStarsInvoice(invoiceId, telegramChargeId)` идемпотентно (ключ — `StarsInvoice.telegramChargeId @unique`) выдаёт товар и помечает инвойс `'paid'`. Леджер при этом **не** пишется — он аудит монет; аудит Stars — сама строка `StarsInvoice`.
- Имена процедур сгруппированы по фичам (`feature.action`) — совпадают с прежними NestJS-модулями.

---
[← Оглавление](./README.md)
