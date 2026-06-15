# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Что это

Lemur Tap — Telegram Mini App аркада (лови купоны → копи монеты/энергию → прокачка, рефералы).
Полная спецификация продукта и механик — в [`spec/app/`](./spec/app/README.md). Спека — источник правды для всех числовых правил и контрактов; код должен ей соответствовать.

Карта продуктовой спеки:
- [01 — Обзор](./spec/app/01-overview.md) · [02 — Архитектура](./spec/app/02-architecture.md) · [03 — Модель данных](./spec/app/03-data-model.md)
- [04 — Экономика](./spec/app/04-economy.md) · [05 — Энергия](./spec/app/05-tap-and-energy.md) · [06 — Мини-игра «Купоны»](./spec/app/06-coupon-game.md)
- [07 — Ежедневный бонус](./spec/app/07-daily-bonus.md) · [08 — Стейкинг](./spec/app/08-staking.md) · [09 — Рефералы](./spec/app/09-referral.md)
- [10 — API](./spec/app/10-api.md) · [11 — Защита от читов](./spec/app/11-anti-cheat.md) · [12 — Прогрессия и баланс](./spec/app/12-progression.md)

Транспорт api↔webapp переведён на **oRPC** (contract-first на zod). Спека слоя и маппинг REST→oRPC — в [`spec/orpc/`](./spec/orpc/README.md): [контракт](./spec/orpc/02-contract.md) · [сервер](./spec/orpc/03-server.md) · [клиент](./spec/orpc/04-client.md) · [процедуры](./spec/orpc/05-procedures.md).

## Команды

pnpm 10, Node ≥22. Запускаются из корня (`pnpm -r` обходит все воркспейсы).

```bash
docker compose up -d postgres redis   # поднять инфраструктуру локально
pnpm install
pnpm build:shared                      # @lemur/shared компилируется в dist — собрать ПЕРВЫМ, остальное зависит от него

pnpm dev                               # api + webapp параллельно (единый origin: Vite проксирует /api → :3000)
pnpm dev:tunnel                        # то же + статичный cloudflared-тунель: один публичный URL на app и API
pnpm back                              # только NestJS API (:3000, префикс /api/v1)
pnpm front                             # только Vite WebApp (:5173)

pnpm typecheck                         # tsc --noEmit во всех воркспейсах
pnpm lint                              # eslint
pnpm test                              # vitest run во всех воркспейсах

# Prisma (проксируют в apps/api)
pnpm prisma:generate
pnpm prisma:migrate                    # migrate dev
pnpm prisma:seed                       # сидит GameConfig из DEFAULT_GAME_CONFIG
```

Один тест: `pnpm -F @lemur/api test <pattern>` или внутри `apps/api` — `pnpm vitest run path/to.spec.ts -t "название"`.

## Воркспейсы

- **`packages/shared`** (`@lemur/shared`) — единственный источник правды для enum'ов (`UpgradeType`, `StakingTier`), кодов ошибок, **zod-схем DTO** (`src/dto/`, типы выводятся через `z.infer`), **oRPC-контракта** (`src/contract/` — дерево процедур на `oc` с input/output/typed errors), **схемы+типа** `GameConfig` (`GameConfigSchema` в `src/config.ts`) и **чистых функций экономики** (`src/economy.ts`). Собирается в `dist`; api и webapp выводят формы запросов/ответов из этого контракта (`class-validator` удалён — валидация zod-схемами).
- **`apps/api`** (`@lemur/api`) — NestJS API + Telegram-бот (grammY). Postgres через Prisma, Redis через ioredis.
- **`apps/webapp`** (`@lemur/webapp`) — React + Vite + `@telegram-apps/sdk-react`, zustand, react-router. **Единая точка входа:** Vite-сервер — единственный публичный origin; он отдаёт webapp и проксирует `/api/*` на API (`:3000`), поэтому клиент ходит по относительным путям (`VITE_API_BASE` пуст), а один статичный cloudflared-тунель (`pnpm dev:tunnel`, `scripts/dev-tunnel.mjs`) покрывает и app, и API. Тунель подставляет свой URL в `WEBAPP_URL` (его открывает бот); именованный туннель и его хост задаются через `CF_TUNNEL_NAME`/`CF_TUNNEL_HOSTNAME`.

## Архитектурные инварианты (не нарушать)

- **Сервер авторитарен; экономика — общий чистый код.** Функции в `packages/shared/src/economy.ts` обязаны давать идентичную математику на клиенте и сервере (клиент — для оптимистичного UI, сервер — финальная истина). Деньги — целые монеты, любое начисление/процент `floor`-ится. Меняешь формулу — меняешь её ОДИН раз в `shared`, не дублируй в api/webapp.
- **Числа экономики живут в БД, не в коде.** Server-side `GameConfig` (версионируемая строка в Postgres) — источник значений; правится без редеплоя. `DEFAULT_GAME_CONFIG` в `shared/src/config.ts` нужен только для сидинга. Webapp **не** импортирует значения — берёт их в рантайме процедурой `users.config`. В `shared` лежит только схема/тип и контракт.
- **Никакого cron / фоновых задач.** Все начисления ленивые (lazy accrual по дельте времени при обращении): энергия (EconomyModule), проценты стейкинга (StakingModule), стрик ежедневного бонуса (DailyModule). Не добавляй планировщики — считай при чтении/записи.
- **oRPC — единственный транспорт; контракт неприкосновенен.** Весь HTTP-обмен идёт RPC-протоколом через один catch-all `@All('rpc/*')` (`OrpcController`, префикс `/api/v1/rpc`). Сервер: `OrpcHandlerService` сливает фрагменты `*.router.ts` в один router и оборачивает в `RPCHandler`; корневой interceptor мапит `AppError` → `ORPCError` (статус из `STATUS_BY_CODE`, `data.code` — доменный snake_case код). Клиент: `apps/webapp/src/api/client.ts` — `RPCLink` + типизированный `ContractRouterClient<typeof contract>`. **Меняешь сигнатуру процедуры — меняешь zod-схему в `shared` ОДИН раз**; api и webapp подхватывают её, рассинхрон ловит компилятор. В `main.ts` Nest стартует с `bodyParser:false` — **критично**: oRPC читает сырой поток запроса, дефолтный express-парсер его бы «съел».
- **Auth — oRPC-middleware, не Nest-guard.** `auth.telegram` — единственная незащищённая процедура: валидирует `initData` (HMAC-SHA256) и свежесть `auth_date`, выдаёт короткоживущий JWT. Остальные процедуры строятся от `authed` (`base.use(authMiddleware)` в `orpc/base.ts`): middleware читает `Authorization: Bearer`, верифицирует JWT и кладёт `{ userId }` в `context.user` (обработчики берут его оттуда, **не** через `@CurrentUser()`). Сам `/rpc` помечен `@Public()`+`@SkipThrottle()`, поэтому глобальные `JwtAuthGuard`/`ThrottlerGuard` его не трогают. На 401 (`ORPCError UNAUTHORIZED`) клиент один раз пере-аутентифицируется и повторяет запрос.
- **Идемпотентность и rate-limit — per-procedure middleware.** Лимиты навешиваются явно: `rateLimit('coupon'|'auth')` в `orpc/base.ts` (fixed-window поверх Redis, окно/макс из live `GameConfig`) — на процедуры из таблицы [05 — процедуры](./spec/orpc/05-procedures.md). Прежние `@Throttle` на контроллерах НЕ переносятся автоматически. **Конечная гарантия — ограничения БД** (леджер/уникальные индексы), Redis — лишь быстрый барьер. См. [11 — анти-чит](./spec/app/11-anti-cheat.md).
- **BigInt.** Деньги в БД — BigInt; в ответах процедур сериализуются как `number` (сервис приводит BigInt→number до возврата). В `main.ts` навешан `BigInt.prototype.toJSON` как страховка от случайного BigInt в ответе.

## Структура модулей API

Один NestJS-модуль на фичу в `apps/api/src/<feature>/` (`*.module.ts` / `*.service.ts` / `*.router.ts`):
Auth, Users, Upgrades, Coupon, Daily, Staking, Referral, Shop, Bot, плюс GameConfig и Economy.
(Shop — магазин корзин/скинов за монеты; каталог из live `GameConfig`, покупки атомарны через ledger + уникальные ограничения. Stars — фаза 4, пока возвращает `STARS_NOT_AVAILABLE`.)
- **`*.router.ts`** заменил прежние `*.controller.ts`: `@Injectable`-класс с методом `build()`, возвращающим фрагмент oRPC-router. Каждая процедура — `authed.<name>.use(rateLimit(...)).handler(({ input, context }) => this.service.<m>(context.user!.userId, …))`, то есть тонкий мост в существующий сервис. Вся бизнес-логика остаётся в `*.service.ts` (их тесты переездом не затронуты).
- **`orpc/`** — мост контракта на рантайм: `base.ts` (`implement(contract)`, `authMiddleware`/`authed`, `rateLimit`), `context.ts` (`OrpcContext`: `req` + инфра-сервисы + `user`), `orpc-handler.service.ts`, `orpc.controller.ts`.
- Общая инфраструктура — `apps/api/src/common/`: `prisma/`, `redis/`, `throttler/` (Redis-storage), `auth/` (JwtAuthGuard, AuthUser — JWT-секрет/верификация переиспользуются middleware), `errors/` (`AppError`, `STATUS_BY_CODE`, `AllExceptionsFilter`), `decorators/` (`@Public()`, `@CurrentUser()` — на `/rpc` не используется).

Соответствие модулей механикам см. в [02 — Архитектура](./spec/app/02-architecture.md); модель данных — [03](./spec/app/03-data-model.md); продуктовый контракт — [10 — API](./spec/app/10-api.md); форма oRPC-процедур — [spec/orpc/05](./spec/orpc/05-procedures.md).

## Соглашение об именовании

Игровые термины в прозе/глоссарии — snake_case (`coupon_mult`, `energy_regen`); поля сущностей и enum-значения в коде — camelCase (`couponMult`, `energyRegen`). Это одни и те же величины.
