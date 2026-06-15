# API (контракт)

## Аутентификация

Все запросы передают Telegram `initData` (заголовок). Сервер валидирует подпись `initData` и выдаёт JWT. Последующие запросы используют заголовок `Authorization: Bearer <jwt>`.

## Эндпоинты

### Auth
- `POST /auth/telegram` — валидация `initData` → JWT + профиль.

### User
- `GET /me` — профиль, балансы (с пересчитанной энергией).
- `GET /config` — текущий `GameConfig`.

### Tap
- `POST /tap` — батч тапов `{ taps }` → новый баланс и энергия.

### Fruit
- `POST /fruit/start` → `sessionId`, `seed`, `nonce`.
- `POST /fruit/finish` — `{ sessionId, score, nonce }` → награда.

### Daily
- `GET /daily` — статус стрика.
- `POST /daily/claim` → награда за день.

### Upgrades
- `GET /upgrades` — уровни и цены апгрейдов (вкл. ветку `vault`).
- `POST /upgrades/:type/buy` — покупка апгрейда (`tap_power | max_energy | energy_regen | fruit_mult | vault`).

### Staking
- `GET /staking` — позиции (`flex`/`lock`), `storageAccrued`, `capacity`, `claimable`, `unlockAt`, текущие ставки.
- `POST /staking/stake` — `{ amount, tier }` (`flex` пополняется; `lock` — новая позиция со своим `unlockAt`).
- `POST /staking/claim` — `{ stakeId }` — собрать накопленное в кошелёк, обнулить хранилище (идемпотентно).
- `POST /staking/unstake` — `{ stakeId }` — вернуть принципал; для `lock` до `unlockAt` — со штрафом (явное подтверждение на клиенте).

### Referral
- `GET /referral` — код, ссылка, список рефералов, заработок.

### Shop (магазин)
Каталог собирается из live `GameConfig` (`baskets`/`skins`) + состояние владения пользователя. Покупки — только за монеты (`currency:'coins'`); `currency:'stars'` зарезервировано под фазу 4 и пока возвращает `STARS_NOT_AVAILABLE`. Все суммы — целые монеты.

- `shop.catalog` — `ShopCatalogResponse { baskets: ShopBasketItem[], skins: ShopSkinItem[], basketTier, equippedSkinId }`. Каждый item несёт обе цены (`priceCoins`, `priceStars`) и флаги состояния (`owned`/`active` для корзин, `owned`/`equipped` для скинов).
- `shop.buyBasket` — `{ tier, currency }` → `ShopPurchaseResponse { coins, basket, skin:null }`. Покупка тира корзины за монеты (атомарно: списание + леджер `basket_purchase` + `User.basketTier`). Ошибки: `INSUFFICIENT_COINS`, `ALREADY_OWNED`, `UNKNOWN_ITEM`, `STARS_NOT_AVAILABLE`.
- `shop.buySkin` — `{ skinId, currency }` → `ShopPurchaseResponse { coins, basket:null, skin }`. Покупка скина за монеты (атомарно: списание + леджер `skin_purchase` + `UserCosmetic`). Ошибки: `INSUFFICIENT_COINS`, `ALREADY_OWNED`, `UNKNOWN_ITEM`, `STARS_NOT_AVAILABLE`.
- `shop.equipSkin` — `{ skinId }` → `ShopPurchaseResponse { coins, basket:null, skin }`. Экипировка владеемого скина (`User.equippedSkinId`); монет не стоит. Ошибки: `NOT_OWNED`, `UNKNOWN_ITEM`.

> `ShopPurchaseResponse`: ровно одно из `basket`/`skin` заполнено для операции, другое — `null`.

> Тела запросов и схемы DTO определены в `packages/shared`.

См. также [02 — Архитектура](./02-architecture.md).

---
[← Оглавление](./README.md)
