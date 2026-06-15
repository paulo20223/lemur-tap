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

> Тела запросов и схемы DTO определены в `packages/shared`.

См. также [02 — Архитектура](./02-architecture.md).

---
[← Оглавление](./README.md)
