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
- `GET /upgrades` — уровни и цены апгрейдов.
- `POST /upgrades/:type/buy` — покупка апгрейда.

### Staking
- `GET /staking` — позиции + накопленное.
- `POST /staking/stake` — `{ amount, tier }`.
- `POST /staking/unstake` — `{ stakeId }`.

### Referral
- `GET /referral` — код, ссылка, список рефералов, заработок.

> Тела запросов и схемы DTO определены в `packages/shared`.

См. также [02 — Архитектура](./02-architecture.md).

---
[← Оглавление](./README.md)
