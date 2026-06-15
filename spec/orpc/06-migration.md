# План миграции

Порядок выбран так, чтобы зависимости шли снизу вверх: `shared` (контракт) → инфра api → процедуры api → клиент → верификация. TDD по каждой процедуре (контрактный тест → реализация).

## Фаза 1 — Контракт в `@lemur/shared`

- Добавить `zod`, `@orpc/contract`.
- Переписать DTO в `src/dto/` как zod-схемы + `z.infer`-типы.
- Добавить `GameConfigSchema`; провалидировать ею `DEFAULT_GAME_CONFIG`.
- Собрать контракт (`oc`) со всеми процедурами и typed errors (см. [02](./02-contract.md), [05](./05-procedures.md)).
- Гейт: `pnpm build:shared` зелёный, типы `z.infer` совпадают с прежними DTO (старые потребители компилируются).

## Фаза 2 — Инфраструктура api

- Добавить `@orpc/server`.
- `OrpcHandlerService` (сборка router + `RPCHandler` + error-mapping interceptor).
- `OrpcController` (`@All('rpc/*')`, `@Public()`), context `{ req }`, prefix `/api/v1/rpc`.
- `authMiddleware` (JWT через существующий `AuthService`/`JwtService` → `context.user`).
- `rateLimit(name)`-middleware поверх существующего Redis-storage.
- Исключить `/rpc` из глобального `JwtAuthGuard`; снять `ValidationPipe` с `/rpc`.

## Фаза 3 — Процедуры api

Пофично (порядок произвольный, фичи независимы): `auth`, `users` (`me`+`config`), `tap`, `upgrades`, `fruit`, `daily`, `staking`, `referral`.

Для каждой: `*.router.ts` с `implement(...)`+`.handler`, делегирующим в существующий сервис. Удалить старый `*.controller.ts` и DTO-классы (`dto/*.dto.ts`). Сервисы и тесты сервисов не трогать.

## Фаза 4 — Клиент webapp

- Добавить `@orpc/client`.
- Заменить `src/api/client.ts` на oRPC-обёртку (`RPCLink` + re-auth, см. [04](./04-client.md)).
- Обновить вызовы в zustand-сторах под новые сигнатуры.
- Удалить старый `ApiClient`/`ApiClientError`.

## Фаза 5 — Верификация

`pnpm build:shared && pnpm typecheck && pnpm test && pnpm lint`, затем ручной прогон (`docker compose up postgres redis` → `pnpm dev` → bootstrap webapp: auth → config → me → tap → апгрейд → фрукты → дейли → стейкинг → рефералы).

## Тестирование

- **Контрактные тесты** (api): на каждую процедуру — валидный input → ожидаемый output-shape; невалидный input → `BAD_REQUEST`; доменная ошибка сервиса → корректный `ORPCError`/typed error.
- **Middleware-тесты:** auth (нет/протух/валиден JWT), rate-limit (превышение → `TOO_MANY_REQUESTS`).
- **Существующие сервис-тесты** остаются без изменений (логика не менялась).

## Риски

- **`@CurrentUser()` → `context.user`:** все обработчики читают пользователя из oRPC-context, не из param-декоратора. Проверить, что нигде не осталось обращений к `req.user` через Nest-декораторы на `/rpc`.
- **Per-procedure throttle:** прежние `@Throttle` на методах контроллеров не переносятся автоматически — лимиты должны явно навешиваться middleware на процедуры из таблицы [05](./05-procedures.md).
- **Сериализация:** деньги остаются `number`; убедиться, что сервисы приводят BigInt→number до возврата (как сейчас).

---
[← Оглавление](./README.md)
