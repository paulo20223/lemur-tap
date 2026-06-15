# Архитектура

## Стек

- **NestJS** — API + Telegram-бот (grammY/Telegraf).
- **React + Vite + @telegram-apps/sdk-react** — WebApp.
- **Postgres** (Prisma) — основное хранилище.
- **Redis** — кэш, rate-limit, идемпотентность.
- **Docker Compose** — локальный и продовый запуск.

## Монорепо (pnpm workspaces)

- `apps/api` — NestJS API и Telegram-бот.
- `apps/webapp` — React-фронтенд WebApp.
- `packages/shared` — общие DTO, типы и конфиг экономики (одна правда для фронта и бэка).

## Модули NestJS

| Модуль | Назначение |
| --- | --- |
| AuthModule | Валидация initData → JWT-сессия |
| UsersModule | Профиль, балансы |
| EconomyModule | Леджер монет/энергии, ленивый расчёт энергии, идемпотентность |
| TapModule | Батч-тап, расход энергии, rate-limit |
| FruitGameModule | Старт/финиш сессии, валидация счёта |
| DailyBonusModule | Стрик, клейм раз в UTC-сутки |
| StakingModule | Stake/claim/unstake, ленивое накопление с капом (Vault), штраф досрочного выхода |
| ReferralModule | Реф-код, startapp, бонусы |
| GameConfigModule | Конфиг экономики |

## Аутентификация

Каждый запрос несёт Telegram `initData`. AuthModule валидирует HMAC и выдаёт короткоживущий JWT, который используется для последующих запросов. Подробнее — [11 — Защита от читов](./11-anti-cheat.md).

См. также: [03 — Модель данных](./03-data-model.md), [10 — API](./10-api.md).

---
[← Оглавление](./README.md)
