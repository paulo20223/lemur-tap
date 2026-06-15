# Миграция на oRPC — спецификация

Перевод контракта между `apps/api` (NestJS) и `apps/webapp` (React+Vite) на [oRPC](https://orpc.unnoq.com): contract-first на zod в `@lemur/shared`, end-to-end типобезопасность, типизированный клиент.

Статус: Draft · 2026-06-14

## Решения (зафиксированы)

- **Объём:** contract-first **поверх** существующего NestJS-рантайма. DI, Prisma, Redis, grammY-бот и сервисы не переписываются — заменяется только контрактный/транспортный слой.
- **Транспорт:** oRPC **RPC-протокол** (`RPCHandler` на сервере, `RPCLink` на клиенте). Не `@orpc/nest @Implement` (он даёт OpenAPI-транспорт, несовместимый с `RPCLink`).
- **Схемы:** **zod** в `@lemur/shared` — единственный источник правды. DTO-типы выводятся через `z.infer`. `class-validator` из api удаляется.

## Содержание

1. [01 — Обзор](./01-overview.md) — цели, мотивация, нон-голы
2. [02 — Контракт](./02-contract.md) — слой `@lemur/shared`: zod-схемы, `oc`, typed errors, `GameConfig`
3. [03 — Сервер](./03-server.md) — `RPCHandler`-мост, реализация процедур, auth/errors/rate-limit
4. [04 — Клиент](./04-client.md) — webapp: oRPC client, re-auth, сторы
5. [05 — Процедуры](./05-procedures.md) — маппинг REST → oRPC (1:1)
6. [06 — План миграции](./06-migration.md) — фазы, зависимости, тестирование, верификация

## Глоссарий

- **контракт** — описание процедуры (input/output/errors) на zod через `oc` из `@orpc/contract`; общий для сервера и клиента.
- **процедура** — единица RPC (аналог прежнего REST-эндпоинта), напр. `tap`, `fruit.start`.
- **router** — дерево процедур; корневой router отдаётся в `RPCHandler`.
- **implementer** — `implement(contract.x)` на сервере, к которому привязывается `.handler` с делегированием в существующий сервис.
- **typed error** — объявленная в контракте ошибка (`.errors({...})`), которую клиент ловит типобезопасно через `safe`/`isDefinedError`.

---

Источник правды по числам экономики не меняется — server-side `GameConfig` в Postgres. oRPC меняет только форму контракта, не бизнес-правила.
